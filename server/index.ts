import 'dotenv/config';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  type WineDoc,
  activeBottles,
  describeLocation,
  findFridge,
  getAllWines,
  getDb,
  getFridges,
  getPreferences,
  getTastings,
  getWineById,
  occupancyFor,
  shelfOf,
  summarize,
} from './db';
import { baseUrlOf, installAuthRoutes, loadAuthConfig, requireBearer, requireOwner } from './auth';
import { TOOLS, type ToolContext, type ToolResult, runTool } from './tools';
import { SERVER_INSTRUCTIONS, createWineMcpServer } from './wine-mcp-server';
import { runMigrations } from './migrate';
import { seedFridges, seedIfEmpty } from './seed';
import { getReport, listReports, runMonthlyReport } from './report';

// Re-exported for older imports
export type { BottleDoc, WineDoc, FridgeDoc, FridgeShelfDoc } from './db';

const db = getDb();
const cfg = loadAuthConfig();
const app = express();
const PORT = Number(process.env.PORT || 3001);

app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

const ctxFor = (req: Request): ToolContext => ({ db, baseUrl: baseUrlOf(req) });

function sendTool(res: Response, r: ToolResult): void {
  if (r.isError) {
    res.status(400).json({ error: r.text, data: r.data });
    return;
  }
  res.json({ ok: true, message: r.text, data: r.data, uiAction: r.uiAction });
}

// ── Public ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Auth: /api/login, /api/logout, /api/me, OAuth 2.1 endpoints + discovery
installAuthRoutes(app, db, cfg);

// ── MCP over Streamable HTTP (bearer token from the OAuth flow) ──────────────

const mcpGuard = requireBearer(cfg);

async function handleMcp(req: Request, res: Response): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createWineMcpServer(ctxFor(req));
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
  }
}

app.post('/mcp', mcpGuard, handleMcp);
app.get('/mcp', mcpGuard, handleMcp);
app.delete('/mcp', mcpGuard, (_req, res) => res.status(200).json({ ok: true }));

// ── Owner API (session cookie from the web app, or a bearer token) ───────────

const guard = requireOwner(cfg);

app.get('/api/wines', guard, async (_req, res) => {
  try {
    const wines = (await getAllWines(db)).map(summarize);
    wines.sort((a, b) => a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name) || a.vintage - b.vintage);
    res.json(wines);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch wines' });
  }
});

app.get('/api/wines/:id', guard, async (req, res) => {
  try {
    const wine = await getWineById(db, req.params.id);
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    const tastings = (await getTastings(db)).filter((t) => t.wineId === wine.id);
    res.json({ ...wine, tastings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch wine' });
  }
});

app.post('/api/wines/:id/description', guard, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured.' });
    return;
  }
  try {
    const ref = db.collection('wines').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    const wine = doc.data() as WineDoc;
    if (wine.description) {
      res.json({ description: wine.description });
      return;
    }
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are an expert sommelier. Write a professional wine description for:

Wine: ${wine.name}
Producer: ${wine.producer}
Vintage: ${wine.vintage}
Type: ${wine.wineType}
Grapes: ${wine.grapes}
Region: ${wine.region}, ${wine.country}
ABV: ${wine.abv}
Drink Window: ${wine.drinkWindowStart ?? '?'}–${wine.drinkWindowEnd ?? '?'}

Provide exactly these sections in markdown:

## Tasting Notes
Describe appearance, aroma, palate, and finish (3-4 sentences).

## Food Pairings
3-4 specific dishes that pair well with this wine.

## Serving Suggestions
Ideal temperature, decanting needs, and glassware (2-3 sentences).

## Cellaring
Aging potential, when it will peak, how it evolves over time (2-3 sentences).

## About the Producer
Brief background on the winery and their style (2-3 sentences).`,
        },
      ],
    });
    const description = message.content[0].type === 'text' ? message.content[0].text : '';
    await ref.update({ description });
    res.json({ description });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate description' });
  }
});

app.patch('/api/wines/:id/bottles/:bottleId/consume', guard, async (req, res) => {
  sendTool(res, await runTool('mark_consumed', { wine: req.params.id, bottle_id: req.params.bottleId }, ctxFor(req)));
});

app.post('/api/wines/:id/bottles/:bottleId/rate', guard, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  sendTool(
    res,
    await runTool(
      'rate_wine',
      { wine: req.params.id, bottle_id: req.params.bottleId, rating: b.rating, liked: b.liked, notes: b.notes, would_buy_again: b.wouldBuyAgain },
      ctxFor(req),
    ),
  );
});

app.patch('/api/wines/:id/bottles/:bottleId/price', guard, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  sendTool(
    res,
    await runTool('update_bottle_price', { wine: req.params.id, bottle_id: req.params.bottleId, price: b.price, currency: b.currency, kind: b.kind }, ctxFor(req)),
  );
});

app.patch('/api/wines/:id/bottles/:bottleId/relocate', guard, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  sendTool(
    res,
    await runTool(
      'set_bottle_location',
      { wine: req.params.id, bottle_id: req.params.bottleId, fridge: b.fridge ?? b.cellar, shelf: b.shelf, position: b.position ?? b.column, depth: b.depth },
      ctxFor(req),
    ),
  );
});

app.delete('/api/wines/:id/bottles/:bottleId', guard, async (req, res) => {
  sendTool(res, await runTool('remove_bottle', { wine: req.params.id, bottle_id: req.params.bottleId }, ctxFor(req)));
});

app.patch('/api/wines/:id/notes', guard, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  sendTool(res, await runTool('add_wine_notes', { wine: req.params.id, notes: b.notes, replace: true }, ctxFor(req)));
});

app.get('/api/fridges', guard, async (_req, res) => {
  try {
    const [fridges, wines] = await Promise.all([getFridges(db), getAllWines(db)]);
    res.json(fridges.map((f) => ({ ...f, occupied: occupancyFor(wines, f.name).length })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch fridges' });
  }
});

app.post('/api/fridges', guard, async (req, res) => {
  sendTool(res, await runTool('save_fridge', (req.body ?? {}) as Record<string, unknown>, ctxFor(req)));
});

/** Occupancy grid for one fridge (web rack view). */
app.get('/api/rack', guard, async (req, res) => {
  try {
    const name = String(req.query.fridge ?? req.query.cellar ?? '');
    const fridge = (name ? await findFridge(db, name) : null) ?? (await getFridges(db))[0];
    const wines = await getAllWines(db);
    res.json({ fridge, slots: occupancyFor(wines, fridge.name) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch rack' });
  }
});

/** Everything the 3D locate page needs. */
app.get('/api/locate/:wineId/:bottleId', guard, async (req, res) => {
  try {
    const wine = await getWineById(db, req.params.wineId);
    if (!wine) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    const bottle = wine.bottles.find((b) => b.id === req.params.bottleId) ?? activeBottles(wine)[0];
    if (!bottle) {
      res.status(404).json({ error: 'Bottle not found' });
      return;
    }
    const fridge = (await findFridge(db, bottle.cellar)) ?? (await getFridges(db))[0];
    const wines = await getAllWines(db);
    const shelf = shelfOf(bottle);
    res.json({
      wine: summarize(wine),
      bottle: { ...bottle, shelf },
      locationText: describeLocation(bottle),
      fridge,
      occupied: occupancyFor(wines, fridge.name),
      highlight: shelf && bottle.column ? { shelf, column: bottle.column } : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to locate bottle' });
  }
});

app.get('/api/tastings', guard, async (_req, res) => res.json(await getTastings(db)));
app.get('/api/preferences', guard, async (_req, res) => res.json(await getPreferences(db)));

// ── Monthly report (Cloud Scheduler with X-Report-Key, or the signed-in owner) ─

function reportKeyOk(req: Request): boolean {
  const expected = process.env.REPORT_KEY?.trim();
  const given = req.get('x-report-key')?.trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const reportGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (reportKeyOk(req)) {
    next();
    return;
  }
  guard(req, res, next);
};

app.post('/api/reports/run', reportGuard, async (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  req.setTimeout(0);
  try {
    const doc = await runMonthlyReport(db, {
      send: b.send !== false,
      refreshPrices: b.refreshPrices !== false,
      recommend: b.recommend !== false,
      baseUrl: baseUrlOf(req),
      limitPriceLookups: typeof b.limitPriceLookups === 'number' ? b.limitPriceLookups : undefined,
    });
    res.json({
      ok: true,
      id: doc.id,
      subject: doc.subject,
      sent: doc.sent,
      error: doc.error,
      totals: doc.summary.totals,
      alerts: { pastPeak: doc.summary.alerts.pastPeak.length, lastCall: doc.summary.alerts.lastCall.length, opening: doc.summary.alerts.opening.length },
      picks: doc.summary.picks.length,
      warnings: doc.summary.warnings,
    });
  } catch (err) {
    console.error('report failed', err);
    res.status(500).json({ error: `Report failed: ${err instanceof Error ? err.message : String(err)}` });
  }
});

app.get('/api/reports', guard, async (_req, res) => res.json(await listReports(db)));

app.get('/api/reports/:id', guard, async (req, res) => {
  const doc = await getReport(db, req.params.id);
  if (!doc) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(doc);
});

app.get('/api/reports/:id/html', guard, async (req, res) => {
  const doc = await getReport(db, req.params.id);
  if (!doc) {
    res.status(404).send('Report not found');
    return;
  }
  res.type('html').send(doc.html);
});

// ── In-app agent (same tools, Anthropic tool-use loop) ───────────────────────

app.post('/api/agent', guard, async (req, res) => {
  const { messages } = req.body as { messages: Anthropic.MessageParam[] };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured' });
    return;
  }
  if (!messages?.length) {
    res.status(400).json({ error: 'messages required' });
    return;
  }
  const client = new Anthropic({ apiKey });
  const ctx = ctxFor(req);
  const tools: Anthropic.Tool[] = TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const system = `${SERVER_INSTRUCTIONS}\n\nYou are chatting inside the Invintory web app. Photos the user attaches are visible to you directly. When a tool returns a fridge picture the app renders it in 3D, so just describe the location in words.`;

  try {
    let msgs = [...messages];
    let uiAction: unknown;
    for (let i = 0; i < 10; i++) {
      const response = await client.messages.create({ model: 'claude-sonnet-4-6', max_tokens: 2048, system, tools, messages: msgs });
      if (response.stop_reason !== 'tool_use') {
        const text = response.content.find((b) => b.type === 'text');
        res.json({ message: text?.type === 'text' ? text.text : '', messages: msgs, uiAction });
        return;
      }
      msgs = [...msgs, { role: 'assistant', content: response.content }];
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const r = await runTool(block.name, block.input as Record<string, unknown>, ctx);
        if (r.uiAction) uiAction = r.uiAction;
        results.push({ type: 'tool_result', tool_use_id: block.id, content: r.text, is_error: !!r.isError });
      }
      msgs = [...msgs, { role: 'user', content: results }];
    }
    res.status(500).json({ error: 'Agent loop exceeded' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Agent error' });
  }
});

// ── Static SPA (production) ───────────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (/^\/(api|mcp|oauth|\.well-known)(\/|$)/.test(req.path)) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}` }));

// ── Startup ───────────────────────────────────────────────────────────────────

(async () => {
  try {
    await seedIfEmpty(db);
    await seedFridges(db);
    const applied = await runMigrations(db);
    if (applied.length) console.log(`Migrations applied: ${applied.join(', ')}`);
  } catch (err) {
    console.error('Startup data error:', err);
  }
  app.listen(PORT, () => console.log(`Invintory server listening on ${PORT}`));
})();
