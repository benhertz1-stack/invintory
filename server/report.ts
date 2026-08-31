import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import type { Firestore } from 'firebase-admin/firestore';
import {
  type TastingDoc,
  type WineDoc,
  activeBottles,
  describeLocation,
  drinkStatus,
  getAllWines,
  getPreferences,
  getTastings,
  normalizeWineType,
  nowIso,
} from './db';

/**
 * Monthly cellar report: drink-window alerts, current prices (looked up on the
 * web by Claude), last month's activity, and buying ideas — emailed and stored.
 */

const MODEL = 'claude-opus-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const PRICE_BATCH = 10;

export interface ReportOptions {
  send: boolean;
  refreshPrices: boolean;
  recommend: boolean;
  baseUrl: string;
  /** Testing aid: only look up prices for the first N wines. */
  limitPriceLookups?: number;
}

export interface AlertRow {
  wineId: string;
  label: string;
  window: string;
  bottles: number;
  location: string;
  note: string;
}

export interface PriceRow {
  wineId: string;
  label: string;
  bottles: number;
  price: number | null;
  value: number;
  previousPrice: number | null;
  change: number | null;
  confidence: string;
  source: string;
}

export interface Pick {
  name: string;
  producer: string;
  vintage: string;
  region: string;
  grapes: string;
  approx_price_usd: number | null;
  why: string;
  value_note: string;
  where_to_buy: string;
}

export interface ReportSummary {
  month: string;
  generatedAt: string;
  since: string;
  totals: { wines: number; bottles: number; value: number; previousValue: number | null; unpriced: number };
  alerts: { pastPeak: AlertRow[]; lastCall: AlertRow[]; opening: AlertRow[]; unknownWindow: number };
  prices: PriceRow[];
  priceRefreshed: boolean;
  activity: { added: string[]; consumed: string[]; tastings: string[]; priceMoves: string[] };
  picks: Pick[];
  marketNotes: string[];
  warnings: string[];
}

export interface ReportDoc {
  id: string;
  month: string;
  createdAt: string;
  subject: string;
  to: string | null;
  sent: boolean;
  error: string | null;
  html: string;
  summary: ReportSummary;
}

interface PriceSnapshot {
  month: string;
  takenAt: string;
  total: number;
  wines: Record<string, { price: number | null; bottles: number; value: number; label: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const money = (n: number | null | undefined): string => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const wineLabel = (w: WineDoc): string => `${w.vintage || 'NV'} ${w.name}`;
const monthKey = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bottleValue(w: WineDoc): { bottles: number; value: number; price: number | null } {
  const active = activeBottles(w);
  const priced = active.filter((b) => b.marketPrice);
  const value = active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
  const price = priced.length ? Math.round((priced.reduce((s, b) => s + (b.marketPrice ?? 0), 0) / priced.length) * 100) / 100 : null;
  return { bottles: active.length, value, price };
}

function extractJson<T>(text: string): T | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  const candidates = fenced.length ? fenced.reverse() : [];
  const first = text.search(/[[{]/);
  if (first >= 0) candidates.push(text.slice(first).trim());
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // try trimming trailing prose
      const end = Math.max(c.lastIndexOf('}'), c.lastIndexOf(']'));
      if (end > 0) {
        try {
          return JSON.parse(c.slice(0, end + 1)) as T;
        } catch {
          /* keep looking */
        }
      }
    }
  }
  return null;
}

// ── Claude ────────────────────────────────────────────────────────────────────

function anthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, timeout: 15 * 60 * 1000, maxRetries: 2 });
}

async function askClaude(
  client: Anthropic,
  opts: { system: string; prompt: string; maxSearches: number; effort: 'low' | 'medium' | 'high' },
): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.prompt }];
  const tools: Anthropic.Beta.BetaToolUnion[] | undefined =
    opts.maxSearches > 0 ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: opts.maxSearches }] : undefined;

  for (let i = 0; i < 8; i++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: opts.system,
      tools,
      output_config: { effort: opts.effort },
      messages,
    });
    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content });
      continue;
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined the request');
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  throw new Error('Claude did not finish within the iteration limit');
}

// ── Sections ──────────────────────────────────────────────────────────────────

export function computeAlerts(wines: WineDoc[], year = new Date().getFullYear()): ReportSummary['alerts'] {
  const pastPeak: AlertRow[] = [];
  const lastCall: AlertRow[] = [];
  const opening: AlertRow[] = [];
  let unknownWindow = 0;
  for (const w of wines) {
    const active = activeBottles(w);
    if (!active.length) continue;
    if (!w.drinkWindowStart || !w.drinkWindowEnd) {
      unknownWindow += 1;
      continue;
    }
    const row: AlertRow = {
      wineId: w.id,
      label: wineLabel(w),
      window: `${w.drinkWindowStart}–${w.drinkWindowEnd}`,
      bottles: active.length,
      location: [...new Set(active.map(describeLocation))].join('; '),
      note: '',
    };
    if (w.drinkWindowEnd < year) {
      row.note = `${year - w.drinkWindowEnd} year${year - w.drinkWindowEnd === 1 ? '' : 's'} past its window`;
      pastPeak.push(row);
    } else if (w.drinkWindowEnd <= year + 1) {
      row.note = w.drinkWindowEnd === year ? 'window closes this year' : 'window closes next year';
      lastCall.push(row);
    } else if (w.drinkWindowStart === year) {
      row.note = 'just entered its window';
      opening.push(row);
    }
  }
  const byEnd = (a: AlertRow, b: AlertRow) => a.window.localeCompare(b.window) || b.bottles - a.bottles;
  pastPeak.sort(byEnd);
  lastCall.sort(byEnd);
  opening.sort(byEnd);
  return { pastPeak, lastCall, opening, unknownWindow };
}

interface PriceLookup {
  id: string;
  price_usd: number | null;
  confidence?: string;
  source?: string;
  note?: string;
}

async function refreshPrices(
  db: Firestore,
  client: Anthropic,
  wines: WineDoc[],
  limit: number | undefined,
  warnings: string[],
): Promise<Map<string, PriceLookup>> {
  const results = new Map<string, PriceLookup>();
  const targets = wines.filter((w) => activeBottles(w).length > 0).slice(0, limit ?? wines.length);
  for (let i = 0; i < targets.length; i += PRICE_BATCH) {
    const batch = targets.slice(i, i + PRICE_BATCH);
    const list = batch
      .map((w) => {
        const { price } = bottleValue(w);
        return `- id: ${w.id} | ${w.vintage || 'NV'} ${w.producer} — ${w.name} | ${w.region}, ${w.country} | ${w.wineType} | last known ${price ? `$${price}` : 'unknown'}`;
      })
      .join('\n');
    try {
      const text = await askClaude(client, {
        system:
          'You are a wine market analyst. You look up current typical US retail prices for specific wines (750 ml, per bottle, not auction lots or magnums) using wine-searcher.com, vivino.com and major US retailers (wine.com, Total Wine, K&L, Wine Library). Be efficient: one or two searches per wine at most. Be honest about uncertainty.',
        prompt:
          `Find the current typical US retail price per bottle for each wine below. Today is ${new Date().toISOString().slice(0, 10)}.\n\n${list}\n\n` +
          'Respond with ONLY a JSON array, one object per wine, in this exact shape:\n' +
          '[{"id": "<id from the list>", "price_usd": <number or null>, "confidence": "high|medium|low", "source": "<site or retailer>", "note": "<one short phrase, e.g. range seen or why unknown>"}]',
        maxSearches: batch.length * 2,
        effort: 'medium',
      });
      const parsed = extractJson<PriceLookup[]>(text);
      if (!parsed || !Array.isArray(parsed)) {
        warnings.push(`Price lookup batch ${i / PRICE_BATCH + 1} returned no parsable data.`);
        continue;
      }
      for (const p of parsed) {
        if (p && typeof p.id === 'string') results.set(p.id, { ...p, price_usd: typeof p.price_usd === 'number' && p.price_usd > 0 ? Math.round(p.price_usd * 100) / 100 : null });
      }
      console.log(`report: prices batch ${i / PRICE_BATCH + 1}/${Math.ceil(targets.length / PRICE_BATCH)} → ${parsed.length} results`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`Price lookup batch ${i / PRICE_BATCH + 1} failed: ${msg}`);
      console.error('report: price batch failed', msg);
    }
  }

  // Persist: update active bottles' market price where we got a usable number
  const checkedAt = nowIso();
  let updates = 0;
  for (const w of targets) {
    const r = results.get(w.id);
    if (!r || r.price_usd == null || r.confidence === 'low') continue;
    const bottles = w.bottles.map((b) => (b.consumed ? b : { ...b, marketPrice: r.price_usd, currency: 'USD' }));
    await db.collection('wines').doc(w.id).update({ bottles, priceCheckedAt: checkedAt, priceSource: r.source ?? '', priceConfidence: r.confidence ?? '' });
    w.bottles = bottles;
    updates += 1;
  }
  console.log(`report: market prices updated on ${updates} wines`);
  return results;
}

interface RecommendationJson {
  picks?: Pick[];
  market_notes?: string[];
}

async function recommendPurchases(
  client: Anthropic,
  wines: WineDoc[],
  tastings: TastingDoc[],
  prefNotes: string[],
  warnings: string[],
): Promise<{ picks: Pick[]; marketNotes: string[] }> {
  const active = wines.filter((w) => activeBottles(w).length > 0);
  const count = (key: (w: WineDoc) => string): string =>
    Object.entries(
      active.reduce<Record<string, number>>((acc, w) => {
        const k = key(w) || 'unknown';
        acc[k] = (acc[k] ?? 0) + activeBottles(w).length;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `${k} (${n})`)
      .join(', ');
  const prices = active.map((w) => bottleValue(w).price).filter((p): p is number => p != null).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  const q1 = prices.length ? prices[Math.floor(prices.length / 4)] : null;
  const q3 = prices.length ? prices[Math.floor((prices.length * 3) / 4)] : null;
  const rated = tastings.filter((t) => t.rating != null);
  const loved = rated.filter((t) => (t.rating as number) >= 4).map((t) => `${t.vintage} ${t.wineName} (${t.rating}/5${t.notes ? `: ${t.notes}` : ''})`);
  const disliked = rated.filter((t) => (t.rating as number) <= 2).map((t) => `${t.vintage} ${t.wineName} (${t.rating}/5${t.notes ? `: ${t.notes}` : ''})`);
  const owned = active.map((w) => `${w.vintage || 'NV'} ${w.producer} ${w.name}`).join('; ');

  const prompt =
    `Today is ${new Date().toISOString().slice(0, 10)}. Recommend wines for a private collector to ADD to their cellar, balancing price and value (quality and critic/community scores relative to price). Use web search to check current US retail prices and recent scores; prefer wines actually available at US retailers now.\n\n` +
    `Collection profile:\n- Bottles by type: ${count((w) => normalizeWineType(w.wineType))}\n- By region: ${count((w) => w.region || w.country)}\n- By grape: ${count((w) => w.grapes.split(',')[0]?.trim() ?? '')}\n- Producers owned: ${count((w) => w.producer)}\n- Price band of current bottles: median ${money(median)}, middle half ${money(q1)}–${money(q3)}\n` +
    `- Wines they loved: ${loved.join('; ') || 'no ratings yet'}\n- Wines they disliked: ${disliked.join('; ') || 'none recorded'}\n- Stated preferences: ${prefNotes.join(' · ') || 'none recorded'}\n- Already owned (avoid duplicates): ${owned}\n\n` +
    `Give 5 picks: 3 in or below their usual price band that over-deliver, 1 stretch bottle that is clearly worth it, and 1 under-the-radar value. Mix regions/grapes they enjoy with one adjacent discovery. For each include approximate US retail price per bottle and where it is sold.\n` +
    `Also give 2–4 short "market notes": recent, verifiable news relevant to producers or regions in this collection (new releases, vintage reports, notable price moves) from the last few months, each with the source name.\n\n` +
    'Respond with ONLY JSON in this exact shape:\n' +
    '{"picks": [{"name": "", "producer": "", "vintage": "", "region": "", "grapes": "", "approx_price_usd": 0, "why": "<2 sentences tied to their taste>", "value_note": "<score/price reasoning>", "where_to_buy": "<retailers>"}], "market_notes": ["<note — Source>"]}';

  try {
    const text = await askClaude(client, {
      system: 'You are a sommelier and wine buyer advising one private collector. Be concrete, current and honest; never invent scores or prices — if unsure, say approximate.',
      prompt,
      maxSearches: 14,
      effort: 'high',
    });
    const parsed = extractJson<RecommendationJson>(text);
    if (!parsed) {
      warnings.push('Recommendations returned no parsable data.');
      return { picks: [], marketNotes: [] };
    }
    const picks = (Array.isArray(parsed.picks) ? parsed.picks : []).slice(0, 6).map((p) => ({
      name: String(p.name ?? ''),
      producer: String(p.producer ?? ''),
      vintage: String(p.vintage ?? ''),
      region: String(p.region ?? ''),
      grapes: String(p.grapes ?? ''),
      approx_price_usd: typeof p.approx_price_usd === 'number' ? p.approx_price_usd : null,
      why: String(p.why ?? ''),
      value_note: String(p.value_note ?? ''),
      where_to_buy: String(p.where_to_buy ?? ''),
    }));
    const marketNotes = (Array.isArray(parsed.market_notes) ? parsed.market_notes : []).map(String).slice(0, 6);
    return { picks, marketNotes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`Recommendations failed: ${msg}`);
    console.error('report: recommendations failed', msg);
    return { picks: [], marketNotes: [] };
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

export function smtpConfigured(): boolean {
  const pass = process.env.SMTP_PASS?.trim();
  return !!(process.env.SMTP_USER?.trim() && pass && pass.toLowerCase() !== 'unset');
}

export function reportRecipient(): string | null {
  return process.env.REPORT_TO?.trim() || process.env.SMTP_USER?.trim() || null;
}

async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const user = process.env.SMTP_USER!.trim();
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass: process.env.SMTP_PASS!.trim() },
  });
  await transporter.sendMail({ from: process.env.REPORT_FROM || `"Invintory" <${user}>`, to, subject, html, text });
}

function renderEmail(s: ReportSummary, baseUrl: string): { html: string; text: string } {
  const wineUrl = (id: string) => `${baseUrl}/collection/${encodeURIComponent(id)}`;
  const monthName = new Date(`${s.month}-15T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const td = 'padding:8px 10px;border-bottom:1px solid #eadfdc;font-size:14px;vertical-align:top;';
  const th = 'padding:8px 10px;border-bottom:2px solid #d9c5c1;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#7d6b72;text-align:left;';
  const h2 = 'font-family:Georgia,serif;font-size:20px;margin:28px 0 10px;color:#3b0f1f;';
  const muted = 'color:#7d6b72;font-size:13px;';

  const alertTable = (rows: AlertRow[], accent: string) =>
    rows.length
      ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
<tr><th style="${th}">Wine</th><th style="${th}">Window</th><th style="${th}">Bottles</th><th style="${th}">Where</th></tr>
${rows
  .map(
    (r) =>
      `<tr><td style="${td}"><a href="${wineUrl(r.wineId)}" style="color:${accent};text-decoration:none;font-weight:600;">${esc(r.label)}</a><br><span style="${muted}">${esc(r.note)}</span></td><td style="${td}">${esc(r.window)}</td><td style="${td}">${r.bottles}</td><td style="${td}${muted}">${esc(r.location)}</td></tr>`,
  )
  .join('\n')}
</table>`
      : `<p style="${muted}">None.</p>`;

  const priceRows = s.prices
    .map((p) => {
      const chg =
        p.change == null
          ? '<span style="color:#9a8d92;">—</span>'
          : p.change === 0
            ? '<span style="color:#9a8d92;">no change</span>'
            : `<span style="color:${p.change > 0 ? '#2f7d4f' : '#b0323f'};font-weight:600;">${p.change > 0 ? '▲' : '▼'} ${money(Math.abs(p.change))}</span>`;
      return `<tr><td style="${td}"><a href="${wineUrl(p.wineId)}" style="color:#3b0f1f;text-decoration:none;">${esc(p.label)}</a>${p.confidence && p.confidence !== 'high' ? `<br><span style="${muted}">${esc(p.confidence)} confidence${p.source ? ` · ${esc(p.source)}` : ''}</span>` : ''}</td><td style="${td}text-align:right;">${p.bottles}</td><td style="${td}text-align:right;">${money(p.price)}</td><td style="${td}text-align:right;">${money(p.value)}</td><td style="${td}text-align:right;">${chg}</td></tr>`;
    })
    .join('\n');

  const list = (items: string[]) => (items.length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:14px;line-height:1.5;">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p style="${muted}">Nothing recorded.</p>`);

  const picks = s.picks.length
    ? s.picks
        .map(
          (p) => `<div style="border:1px solid #eadfdc;border-radius:10px;padding:12px 14px;margin:0 0 10px;">
<div style="font-weight:600;font-size:15px;color:#3b0f1f;">${esc([p.vintage, p.producer, p.name].filter(Boolean).join(' '))} <span style="float:right;color:#8f1c3a;">${money(p.approx_price_usd)}</span></div>
<div style="${muted}">${esc([p.region, p.grapes].filter(Boolean).join(' · '))}</div>
<div style="font-size:14px;margin-top:6px;line-height:1.5;">${esc(p.why)}</div>
<div style="font-size:13px;margin-top:4px;color:#5a4a50;"><b>Value:</b> ${esc(p.value_note)}</div>
<div style="${muted}margin-top:4px;"><b>Where:</b> ${esc(p.where_to_buy)}</div>
</div>`,
        )
        .join('\n')
    : `<p style="${muted}">No recommendations this month.</p>`;

  const valueLine =
    s.totals.previousValue != null
      ? ` (${s.totals.value >= s.totals.previousValue ? '+' : '−'}${money(Math.abs(s.totals.value - s.totals.previousValue))} vs last report)`
      : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Invintory — ${esc(monthName)}</title></head>
<body style="margin:0;background:#f6efed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#2b1a21;">
<div style="max-width:680px;margin:0 auto;padding:20px 14px;">
<div style="background:#3b0f1f;color:#f7e9ec;border-radius:14px;padding:22px 24px;">
<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;">Invintory · monthly cellar report</div>
<div style="font-family:Georgia,serif;font-size:28px;margin-top:6px;">${esc(monthName)}</div>
<div style="margin-top:12px;font-size:15px;line-height:1.5;">${s.totals.bottles} bottles across ${s.totals.wines} wines · estimated value <b>${money(s.totals.value)}</b>${esc(valueLine)}${s.totals.unpriced ? ` · ${s.totals.unpriced} unpriced` : ''}</div>
<div style="margin-top:8px;font-size:14px;">${s.alerts.pastPeak.length ? `<b>${s.alerts.pastPeak.length}</b> past peak · ` : ''}<b>${s.alerts.lastCall.length}</b> last call · <b>${s.alerts.opening.length}</b> just opened</div>
</div>

<div style="background:#fff;border-radius:14px;padding:6px 22px 22px;margin-top:14px;">
<h2 style="${h2}">Drink soon</h2>
${s.alerts.pastPeak.length ? `<div style="font-size:13px;font-weight:600;color:#b0323f;margin:10px 0 4px;">Past their window</div>${alertTable(s.alerts.pastPeak, '#b0323f')}` : ''}
<div style="font-size:13px;font-weight:600;color:#a05a00;margin:14px 0 4px;">Last call (window closes this year or next)</div>
${alertTable(s.alerts.lastCall, '#a05a00')}
<div style="font-size:13px;font-weight:600;color:#2f7d4f;margin:14px 0 4px;">Just entered their window</div>
${alertTable(s.alerts.opening, '#2f7d4f')}
${s.alerts.unknownWindow ? `<p style="${muted}margin-top:10px;">${s.alerts.unknownWindow} wine${s.alerts.unknownWindow === 1 ? '' : 's'} have no drinking window recorded — ask Claude to fill them in.</p>` : ''}

<h2 style="${h2}">Prices ${s.priceRefreshed ? '<span style="font-size:12px;font-weight:normal;color:#7d6b72;">· refreshed from the web this month</span>' : ''}</h2>
<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
<tr><th style="${th}">Wine</th><th style="${th}text-align:right;">Btls</th><th style="${th}text-align:right;">Per bottle</th><th style="${th}text-align:right;">Value</th><th style="${th}text-align:right;">vs last month</th></tr>
${priceRows}
<tr><td style="${td}font-weight:700;">Total</td><td style="${td}text-align:right;font-weight:700;">${s.totals.bottles}</td><td style="${td}"></td><td style="${td}text-align:right;font-weight:700;">${money(s.totals.value)}</td><td style="${td}text-align:right;font-weight:700;">${s.totals.previousValue == null ? '—' : `${s.totals.value - s.totals.previousValue >= 0 ? '▲' : '▼'} ${money(Math.abs(s.totals.value - s.totals.previousValue))}`}</td></tr>
</table>

<h2 style="${h2}">Since the last report <span style="font-size:12px;font-weight:normal;color:#7d6b72;">· from ${esc(s.since.slice(0, 10))}</span></h2>
<div style="font-size:13px;font-weight:600;margin-top:8px;">Added</div>${list(s.activity.added)}
<div style="font-size:13px;font-weight:600;margin-top:12px;">Opened</div>${list(s.activity.consumed)}
<div style="font-size:13px;font-weight:600;margin-top:12px;">Ratings</div>${list(s.activity.tastings)}
<div style="font-size:13px;font-weight:600;margin-top:12px;">Notable price moves</div>${list(s.activity.priceMoves)}

<h2 style="${h2}">Worth adding this month</h2>
<p style="${muted}margin-top:-4px;">Chosen from your ratings and preferences, balancing price against quality.</p>
${picks}
${s.marketNotes.length ? `<h2 style="${h2}">Around the market</h2>${list(s.marketNotes)}` : ''}
${s.warnings.length ? `<p style="${muted}margin-top:18px;">Notes: ${esc(s.warnings.join(' '))}</p>` : ''}
</div>

<p style="${muted}text-align:center;margin:18px 0 0;">Open the <a href="${baseUrl}" style="color:#8f1c3a;">cellar</a> · past reports at <a href="${baseUrl}/reports" style="color:#8f1c3a;">${esc(baseUrl.replace(/^https?:\/\//, ''))}/reports</a></p>
</div></body></html>`;

  const text = [
    `Invintory — ${monthName}`,
    `${s.totals.bottles} bottles across ${s.totals.wines} wines, est. value ${money(s.totals.value)}${valueLine}`,
    '',
    'PAST PEAK: ' + (s.alerts.pastPeak.map((r) => `${r.label} (${r.window}, ${r.bottles})`).join('; ') || 'none'),
    'LAST CALL: ' + (s.alerts.lastCall.map((r) => `${r.label} (${r.window}, ${r.bottles})`).join('; ') || 'none'),
    'JUST OPENED: ' + (s.alerts.opening.map((r) => `${r.label} (${r.window}, ${r.bottles})`).join('; ') || 'none'),
    '',
    'PRICES:',
    ...s.prices.map((p) => `  ${p.label}: ${p.bottles} × ${money(p.price)} = ${money(p.value)}${p.change != null ? ` (${p.change >= 0 ? '+' : ''}${money(p.change)})` : ''}`),
    '',
    'SINCE LAST REPORT:',
    `  added: ${s.activity.added.join('; ') || 'none'}`,
    `  opened: ${s.activity.consumed.join('; ') || 'none'}`,
    `  ratings: ${s.activity.tastings.join('; ') || 'none'}`,
    `  price moves: ${s.activity.priceMoves.join('; ') || 'none'}`,
    '',
    'WORTH ADDING:',
    ...s.picks.map((p) => `  ${[p.vintage, p.producer, p.name].filter(Boolean).join(' ')} — ${money(p.approx_price_usd)} — ${p.why} (${p.value_note}) — ${p.where_to_buy}`),
    ...(s.marketNotes.length ? ['', 'AROUND THE MARKET:', ...s.marketNotes.map((n) => `  - ${n}`)] : []),
    '',
    `${baseUrl}`,
  ].join('\n');

  return { html, text };
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export async function listReports(db: Firestore): Promise<Array<Omit<ReportDoc, 'html' | 'summary'>>> {
  const snap = await db.collection('reports').orderBy('createdAt', 'desc').limit(36).get();
  return snap.docs.map((d) => {
    const { html: _h, summary: _s, ...rest } = d.data() as ReportDoc;
    return rest;
  });
}

export async function getReport(db: Firestore, id: string): Promise<ReportDoc | null> {
  const doc = await db.collection('reports').doc(id).get();
  return doc.exists ? (doc.data() as ReportDoc) : null;
}

export async function runMonthlyReport(db: Firestore, opts: ReportOptions): Promise<ReportDoc> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const month = monthKey();
  const generatedAt = nowIso();
  console.log(`report: starting ${month} (send=${opts.send}, refreshPrices=${opts.refreshPrices}, recommend=${opts.recommend})`);

  const [wines, tastings, prefs, lastReportSnap, snapshotsSnap] = await Promise.all([
    getAllWines(db),
    getTastings(db),
    getPreferences(db),
    db.collection('reports').orderBy('createdAt', 'desc').limit(1).get(),
    db.collection('price_snapshots').orderBy('month', 'desc').limit(3).get(),
  ]);
  const lastReport = lastReportSnap.docs[0]?.data() as ReportDoc | undefined;
  const since = lastReport?.createdAt ?? new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  const previousSnapshot = snapshotsSnap.docs.map((d) => d.data() as PriceSnapshot).find((s) => s.month !== month) ?? null;

  const client = anthropicClient();
  if (!client && (opts.refreshPrices || opts.recommend)) warnings.push('ANTHROPIC_API_KEY is not configured, so prices were not refreshed and no recommendations were made.');

  // 1. Prices (optionally refreshed on the web)
  let lookups = new Map<string, PriceLookup>();
  if (client && opts.refreshPrices) lookups = await refreshPrices(db, client, wines, opts.limitPriceLookups, warnings);

  const active = wines.filter((w) => activeBottles(w).length > 0);
  const prices: PriceRow[] = active
    .map((w) => {
      const { bottles, value, price } = bottleValue(w);
      const prev = previousSnapshot?.wines[w.id]?.price ?? null;
      const lookup = lookups.get(w.id);
      return {
        wineId: w.id,
        label: wineLabel(w),
        bottles,
        price,
        value,
        previousPrice: prev,
        change: price != null && prev != null ? Math.round((price - prev) * 100) / 100 : null,
        confidence: lookup?.confidence ?? '',
        source: lookup?.source ?? '',
      };
    })
    .sort((a, b) => b.value - a.value);
  const totals = {
    wines: active.length,
    bottles: active.reduce((s, w) => s + activeBottles(w).length, 0),
    value: Math.round(prices.reduce((s, p) => s + p.value, 0)),
    previousValue: previousSnapshot ? Math.round(previousSnapshot.total) : null,
    unpriced: prices.filter((p) => p.price == null).length,
  };

  // Snapshot this month's prices for next time
  const snapshot: PriceSnapshot = {
    month,
    takenAt: generatedAt,
    total: totals.value,
    wines: Object.fromEntries(prices.map((p) => [p.wineId, { price: p.price, bottles: p.bottles, value: p.value, label: p.label }])),
  };
  await db.collection('price_snapshots').doc(month).set(snapshot);

  // 2. Drink-window alerts
  const alerts = computeAlerts(wines);

  // 3. Activity since the last report
  const added: string[] = [];
  const consumed: string[] = [];
  for (const w of wines) {
    const a = w.bottles.filter((b) => b.addedOn && b.addedOn >= since).length;
    if (a) added.push(`${wineLabel(w)} × ${a}`);
    const c = w.bottles.filter((b) => b.consumed && b.consumedAt && b.consumedAt >= since).length;
    if (c) consumed.push(`${wineLabel(w)} × ${c}`);
  }
  const tastingLines = tastings
    .filter((t) => t.tastedAt >= since)
    .map((t) => `${t.vintage} ${t.wineName}: ${t.rating != null ? `${t.rating}/5` : t.liked ? 'liked' : 'not a fan'}${t.wouldBuyAgain ? ', would buy again' : ''}${t.notes ? ` — “${t.notes}”` : ''}`);
  const priceMoves = prices
    .filter((p) => p.change != null && p.previousPrice && Math.abs(p.change) / p.previousPrice >= 0.08)
    .sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!))
    .slice(0, 8)
    .map((p) => `${p.label}: ${money(p.previousPrice)} → ${money(p.price)} (${p.change! > 0 ? '+' : ''}${Math.round((p.change! / p.previousPrice!) * 100)}%)`);

  // 4. Buying ideas + market notes
  let picks: Pick[] = [];
  let marketNotes: string[] = [];
  if (client && opts.recommend) ({ picks, marketNotes } = await recommendPurchases(client, wines, tastings, prefs.notes, warnings));

  const summary: ReportSummary = {
    month,
    generatedAt,
    since,
    totals,
    alerts,
    prices,
    priceRefreshed: !!(client && opts.refreshPrices),
    activity: { added, consumed, tastings: tastingLines, priceMoves },
    picks,
    marketNotes,
    warnings,
  };

  const { html, text } = renderEmail(summary, opts.baseUrl);
  const monthName = new Date(`${month}-15T00:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const urgent = alerts.lastCall.length + alerts.pastPeak.length;
  const headline = urgent
    ? `${urgent} to drink soon`
    : alerts.opening.length
      ? `${alerts.opening.length} just entered their window`
      : `${money(totals.value)} in the cellar`;
  const subject = `Your cellar — ${monthName}: ${totals.bottles} bottles, ${headline}`;

  // 5. Email
  let sent = false;
  let error: string | null = null;
  const to = reportRecipient();
  if (opts.send) {
    if (!smtpConfigured() || !to) {
      error = 'Email not configured (SMTP_USER / SMTP_PASS / REPORT_TO). Report saved but not sent.';
    } else {
      try {
        await sendEmail(to, subject, html, text);
        sent = true;
      } catch (e) {
        error = `Email failed: ${e instanceof Error ? e.message : String(e)}`;
        console.error('report: email failed', e);
      }
    }
  }

  const id = `${month}-${Date.now().toString(36)}`;
  const doc: ReportDoc = { id, month, createdAt: generatedAt, subject, to: opts.send ? to : null, sent, error, html, summary };
  await db.collection('reports').doc(id).set(doc);
  console.log(`report: done ${id} in ${Math.round((Date.now() - startedAt) / 1000)}s (sent=${sent}${error ? `, error=${error}` : ''})`);
  return doc;
}
