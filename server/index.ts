import 'dotenv/config';
import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createWineMcpServer } from './wine-mcp-server';

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'invintory-495823' });
const db = admin.firestore();

const app = express();
const PORT = process.env.PORT || 3001;
app.use(express.json({ limit: '2mb' }));

export interface BottleDoc {
  id: string;
  cellar: string;
  size: string;
  purchasePrice: number | null;
  marketPrice: number | null;
  currency: string;
  purchaseDate: string;
  location: string;
  section: string;
  row: number | null;
  column: number | null;
  depth: number | null;
  addedOn: string;
  personalNotes: string;
  bottleCode: string;
  barcode: string;
  consumed: boolean;
}

export interface WineDoc {
  id: string;
  name: string;
  vintage: number;
  wineType: string;
  grapes: string;
  producer: string;
  country: string;
  region: string;
  abv: string;
  drinkWindowStart: number | null;
  drinkWindowEnd: number | null;
  description: string | null;
  collectionNotes: string;
  bottles: BottleDoc[];
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseInt2(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

async function seedIfEmpty() {
  const snap = await db.collection('wines').limit(1).get();
  if (!snap.empty) {
    console.log('Firestore already seeded, skipping.');
    return;
  }

  const csvPath = path.join(process.cwd(), 'server', 'data', 'collection.csv');
  const raw = readFileSync(csvPath, 'utf-8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];

  const wineMap = new Map<string, WineDoc>();
  const usedIds = new Set<string>();

  for (const row of rows) {
    const name = row['Wine Name']?.trim() ?? '';
    const vintage = parseInt2(row['Vintage']) ?? 0;
    const key = `${name}__${vintage}`;

    if (!wineMap.has(key)) {
      const base = slugify(`${row['Producer'] || name}-${vintage}`);
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}-${suffix++}`;
      usedIds.add(id);

      wineMap.set(key, {
        id,
        name,
        vintage,
        wineType: row['Wine Type']?.trim() ?? '',
        grapes: row['Grapes']?.trim() ?? '',
        producer: row['Producer']?.trim() ?? '',
        country: row['Country']?.trim() ?? '',
        region: row['Region']?.trim() ?? '',
        abv: row['ABV']?.trim() ?? '',
        drinkWindowStart: parseInt2(row['Drink Window Start']),
        drinkWindowEnd: parseInt2(row['Drink Window End']),
        description: null,
        collectionNotes: '',
        bottles: [],
      });
    }

    const wine = wineMap.get(key)!;
    const bottleId = row['Bottle Code']?.trim() || row['Barcode']?.trim() || `b${wine.bottles.length}`;

    wine.bottles.push({
      id: bottleId,
      cellar: row['Cellar or Fridge Name']?.trim() ?? '',
      size: row['Size']?.trim() ?? '750ml',
      purchasePrice: parseNum(row['Purchase Price']),
      marketPrice: parseNum(row['Market Price (USD)']),
      currency: row['Currency']?.trim() || 'USD',
      purchaseDate: row['Purchase Date']?.trim() ?? '',
      location: row['Custom Bottle Location']?.trim() ?? '',
      section: row['Section Name']?.trim() ?? '',
      row: parseInt2(row['Row']),
      column: parseInt2(row['Column']),
      depth: parseInt2(row['Depth']),
      addedOn: row['Added On']?.trim() ?? '',
      personalNotes: row['Personal Notes']?.trim() ?? '',
      bottleCode: row['Bottle Code']?.trim() ?? '',
      barcode: row['Barcode']?.trim() ?? '',
      consumed: false,
    });
  }

  const wines = [...wineMap.values()];
  for (let i = 0; i < wines.length; i += 400) {
    const batch = db.batch();
    for (const wine of wines.slice(i, i + 400)) {
      batch.set(db.collection('wines').doc(wine.id), wine);
    }
    await batch.commit();
  }
  console.log(`Seeded ${wines.length} wines to Firestore.`);
}

// --- API ---

app.get('/api/wines', async (_req, res) => {
  try {
    const snap = await db.collection('wines').get();
    const wines = snap.docs.map((doc) => {
      const d = doc.data() as WineDoc;
      const active = d.bottles.filter((b) => !b.consumed);
      const marketValue = active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
      return {
        id: d.id,
        name: d.name,
        vintage: d.vintage,
        wineType: d.wineType,
        grapes: d.grapes,
        producer: d.producer,
        country: d.country,
        region: d.region,
        abv: d.abv,
        drinkWindowStart: d.drinkWindowStart,
        drinkWindowEnd: d.drinkWindowEnd,
        bottleCount: active.length,
        marketValue,
        hasDescription: !!d.description,
      };
    });
    wines.sort((a, b) => a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name));
    res.json(wines);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch wines' });
  }
});

app.get('/api/wines/:id', async (req, res) => {
  try {
    const doc = await db.collection('wines').doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    res.json(doc.data());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch wine' });
  }
});

app.post('/api/wines/:id/description', async (req, res) => {
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

app.patch('/api/wines/:id/bottles/:bottleId/consume', async (req, res) => {
  try {
    const ref = db.collection('wines').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    const wine = doc.data() as WineDoc;
    const bottles = wine.bottles.map((b) =>
      b.id === req.params.bottleId ? { ...b, consumed: true } : b
    );
    await ref.update({ bottles });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update bottle' });
  }
});

app.patch('/api/wines/:id/bottles/:bottleId/price', async (req, res) => {
  const { price, currency } = req.body as { price: number; currency?: string };
  try {
    const ref = db.collection('wines').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    const wine = doc.data() as WineDoc;
    const bottles = wine.bottles.map((b) =>
      b.id === req.params.bottleId
        ? { ...b, purchasePrice: price, currency: currency ?? b.currency }
        : b
    );
    await ref.update({ bottles });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

app.patch('/api/wines/:id/notes', async (req, res) => {
  const { notes } = req.body as { notes: string };
  try {
    const ref = db.collection('wines').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Wine not found' });
      return;
    }
    await ref.update({ collectionNotes: notes });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

app.post('/api/advisor', async (req, res) => {
  const { question } = req.body as { question: string };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY not configured on the server.' });
    return;
  }
  if (!question) {
    res.status(400).json({ error: 'Missing question' });
    return;
  }

  try {
    const snap = await db.collection('wines').get();
    const lines: string[] = [];
    for (const doc of snap.docs) {
      const d = doc.data() as WineDoc;
      const active = d.bottles.filter((b) => !b.consumed);
      if (active.length === 0) continue;
      const value = active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
      const window =
        d.drinkWindowStart && d.drinkWindowEnd
          ? ` (drink ${d.drinkWindowStart}–${d.drinkWindowEnd})`
          : '';
      lines.push(
        `- "${d.name}" ${d.vintage}, ${d.wineType}, ${d.region}${window} — ${active.length} bottle(s)${value > 0 ? `, ~$${value.toFixed(0)} market value` : ''}`
      );
    }
    const collectionSummary = lines.join('\n');

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are a knowledgeable sommelier and wine advisor with access to a user's personal wine collection.
Answer questions about wine choices, food pairings, which bottles to open for occasions, aging potential, tasting notes, and general wine advice.
Be specific about wines in the collection when relevant. Keep responses concise and practical.`,
      messages: [
        {
          role: 'user',
          content: `Here is my wine collection:\n\n${collectionSummary}\n\n${question}`,
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    res.json({ answer: text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get response from Claude.' });
  }
});

// Delete a bottle permanently
app.delete('/api/wines/:id/bottles/:bottleId', async (req, res) => {
  try {
    const ref = db.collection('wines').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json({ error: 'Wine not found' }); return; }
    const wine = doc.data() as WineDoc;
    const bottles = wine.bottles.filter((b) => b.id !== req.params.bottleId);
    await ref.update({ bottles });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete bottle' });
  }
});

// Relocate a bottle to a new position
app.patch('/api/wines/:id/bottles/:bottleId/relocate', async (req, res) => {
  const { cellar, location, section, row, column, depth } = req.body as {
    cellar?: string; location?: string; section?: string;
    row?: number; column?: number; depth?: number;
  };
  try {
    const ref = db.collection('wines').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) { res.status(404).json({ error: 'Wine not found' }); return; }
    const wine = doc.data() as WineDoc;
    const bottles = wine.bottles.map((b) =>
      b.id === req.params.bottleId
        ? {
            ...b,
            cellar: cellar ?? b.cellar,
            location: location ?? b.location,
            section: section ?? b.section,
            row: row ?? b.row,
            column: column ?? b.column,
            depth: depth ?? b.depth,
          }
        : b
    );
    await ref.update({ bottles });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to relocate bottle' });
  }
});

// Rack view — all active bottle positions in a given cellar + location
app.get('/api/rack', async (req, res) => {
  const { cellar, location } = req.query as { cellar: string; location?: string };
  if (!cellar) { res.status(400).json({ error: 'cellar param required' }); return; }
  try {
    const snap = await db.collection('wines').get();
    const slots: Array<{
      bottleId: string; wineId: string; wineName: string; vintage: number;
      size: string; barcode: string; bottleCode: string; addedOn: string;
      cellar: string; location: string; section: string;
      row: number | null; column: number | null; depth: number | null;
    }> = [];

    snap.docs.forEach((doc) => {
      const d = doc.data() as WineDoc;
      d.bottles
        .filter((b) => !b.consumed && b.cellar === cellar && (!location || b.location === location))
        .forEach((b) => {
          slots.push({
            bottleId: b.id,
            wineId: d.id,
            wineName: d.name,
            vintage: d.vintage,
            size: b.size,
            barcode: b.barcode,
            bottleCode: b.bottleCode,
            addedOn: b.addedOn,
            cellar: b.cellar,
            location: b.location,
            section: b.section,
            row: b.row,
            column: b.column,
            depth: b.depth,
          });
        });
    });

    const maxRow = Math.max(1, ...slots.map((s) => s.row ?? 0));
    const maxCol = Math.max(1, ...slots.map((s) => s.column ?? 0));
    res.json({ cellar, location: location ?? '', maxRow, maxCol, slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch rack data' });
  }
});

// MCP over HTTP — stateless, one transport per request (works on Cloud Run)
app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createWineMcpServer(db);
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on('close', () => mcpServer.close().catch(() => {}));
});

app.get('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createWineMcpServer(db);
  await mcpServer.connect(transport);
  await transport.handleRequest(req, res);
  res.on('close', () => mcpServer.close().catch(() => {}));
});

if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

(async () => {
  try {
    await seedIfEmpty();
  } catch (err) {
    console.error('Seed error:', err);
  }
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
