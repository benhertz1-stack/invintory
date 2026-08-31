import type { Firestore } from 'firebase-admin/firestore';
import {
  type BottleDoc,
  type FridgeDoc,
  type FridgeShelfDoc,
  type TastingDoc,
  type WineDoc,
  activeBottles,
  describeLocation,
  drinkStatus,
  findFridge,
  getAllWines,
  getFridges,
  getPreferences,
  getTastings,
  matchScore,
  normalizeWineType,
  nowIso,
  occupancyFor,
  pickBottle,
  shelfOf,
  slugify,
  summarize,
} from './db';
import { renderFridgePng } from './render';

/**
 * Single registry of cellar tools. Exposed verbatim over MCP (Claude app / Claude Desktop)
 * and to the in-app Anthropic agent, so both paths share one implementation.
 */

export interface ToolContext {
  db: Firestore;
  /** Public origin used to build links, e.g. https://invintory-xxxx.run.app */
  baseUrl: string;
}

export interface ToolImage {
  data: string; // base64
  mimeType: string;
}

export interface ToolResult {
  text: string;
  data?: unknown;
  image?: ToolImage;
  uiAction?: unknown;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
  destructive?: boolean;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ── Input helpers ─────────────────────────────────────────────────────────────

function str(input: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function num(input: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function bool(input: Record<string, unknown>, key: string): boolean | null {
  const v = input[key];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|y|1)$/i.test(v)) return true;
    if (/^(false|no|n|0)$/i.test(v)) return false;
  }
  return null;
}

function err(text: string, data?: unknown): ToolResult {
  return { text, data, isError: true };
}

const WINE_REF = {
  type: 'string',
  description:
    "Which wine: the wine ID from list_wines/search_wines, or descriptive text such as '2019 Bevan Ontogeny'.",
};

// ── Formatting ────────────────────────────────────────────────────────────────

function windowText(w: WineDoc): string {
  if (!w.drinkWindowStart || !w.drinkWindowEnd) return 'window unknown';
  const s = drinkStatus(w);
  const label = s === 'drink' ? 'drink now' : s === 'hold' ? 'hold' : s === 'past' ? 'past peak' : '';
  return `${w.drinkWindowStart}–${w.drinkWindowEnd}${label ? ` (${label})` : ''}`;
}

function wineLine(w: WineDoc): string {
  const active = activeBottles(w);
  const locs = [...new Set(active.map(describeLocation))];
  return (
    `- **${w.vintage} ${w.name}** — ${w.producer}` +
    ` · ${w.wineType || 'wine'} · ${w.region || w.country}` +
    ` · ${active.length} bottle${active.length === 1 ? '' : 's'}` +
    ` · ${windowText(w)}` +
    (locs.length ? ` · ${locs.join(' / ')}` : '') +
    ` · id: \`${w.id}\``
  );
}

function bottleLine(b: BottleDoc): string {
  const price = b.marketPrice ? `$${b.marketPrice.toFixed(0)} market` : b.purchasePrice ? `$${b.purchasePrice.toFixed(0)} paid` : 'unpriced';
  return `  - bottle \`${b.id}\`: ${b.consumed ? 'CONSUMED' : describeLocation(b)} · ${b.size || '750ml'} · ${price}${b.personalNotes ? ` · ${b.personalNotes}` : ''}`;
}

function fridgeSummaryLine(f: FridgeDoc, occupiedCount: number): string {
  const slots = f.shelves.reduce((s, sh) => s + sh.cols * (sh.depth ?? 1), 0);
  return `- **${f.name}**${f.model ? ` (${f.model})` : ''} — ${f.shelves.length} shelves, ${slots} slots, ${occupiedCount} occupied · id: \`${f.id}\``;
}

// ── Wine / bottle / fridge resolution ─────────────────────────────────────────

type Resolved = { wine: WineDoc; wines: WineDoc[] } | { error: ToolResult };

async function resolveWine(ctx: ToolContext, input: Record<string, unknown>, preloaded?: WineDoc[]): Promise<Resolved> {
  const ref = str(input, 'wine', 'wine_id', 'id', 'query', 'name');
  if (!ref) return { error: err('Tell me which wine: pass `wine` as its ID or name.') };
  const wines = preloaded ?? (await getAllWines(ctx.db));
  const byId = wines.find((w) => w.id === ref);
  if (byId) return { wine: byId, wines };

  const scored = wines
    .map((w) => ({ w, s: matchScore(w, ref) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (!scored.length) return { error: err(`No wine in the collection matches "${ref}". Try search_wines with fewer words.`) };

  const top = scored[0].s;
  const ties = scored.filter((x) => x.s === top);
  const withActive = ties.filter((x) => activeBottles(x.w).length > 0);
  const cands = withActive.length ? withActive : ties;
  if (cands.length === 1) return { wine: cands[0].w, wines };

  return {
    error: {
      text:
        `Several wines match "${ref}" — ask the user which one, then call again with the id:\n` +
        cands.slice(0, 8).map((x) => wineLine(x.w)).join('\n'),
      data: cands.slice(0, 8).map((x) => summarize(x.w)),
      isError: false,
    },
  };
}

interface Placement {
  fridge: FridgeDoc;
  shelf: number;
  column: number;
  depth: number;
}

async function resolvePlacement(
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<{ placement: Placement } | { error: ToolResult } | { placement: null }> {
  const fridgeRef = str(input, 'fridge', 'fridge_name', 'cellar');
  const shelf = num(input, 'shelf', 'shelf_row', 'row');
  const column = num(input, 'position', 'column', 'col', 'slot');
  const depth = num(input, 'depth') ?? 1;

  if (!fridgeRef && shelf == null && column == null) return { placement: null };

  const fridges = await getFridges(ctx.db);
  let fridge: FridgeDoc | null = null;
  if (fridgeRef) {
    fridge = await findFridge(ctx.db, fridgeRef);
    if (!fridge) {
      return {
        error: err(
          `I don't know a fridge called "${fridgeRef}". Known fridges: ${fridges.map((f) => `"${f.name}"`).join(', ')}. ` +
            `If this is a new fridge, ask the user for a photo of it, count the shelves and slots, confirm, then call save_fridge.`,
        ),
      };
    }
  } else if (fridges.length === 1) {
    fridge = fridges[0];
  } else {
    return { error: err(`Which fridge? Known fridges: ${fridges.map((f) => `"${f.name}"`).join(', ')}.`) };
  }

  if (shelf == null || column == null) {
    return {
      error: err(
        `Ask the user which shelf (counted from the top, 1–${fridge.shelves.length}) and which position from the left, then call again with \`shelf\` and \`position\`.`,
      ),
    };
  }
  const shelfCfg = fridge.shelves.find((s) => s.row === shelf);
  if (!shelfCfg) {
    return { error: err(`"${fridge.name}" has shelves 1–${fridge.shelves.length} (from the top). Shelf ${shelf} doesn't exist.`) };
  }
  if (column < 1 || column > shelfCfg.cols) {
    return { error: err(`Shelf ${shelf} of "${fridge.name}" holds ${shelfCfg.cols} bottles across (positions 1–${shelfCfg.cols}). Position ${column} is out of range.`) };
  }
  const maxDepth = shelfCfg.depth ?? 2;
  if (depth < 1 || depth > maxDepth) {
    return { error: err(`Depth must be 1 (front) to ${maxDepth} for that shelf.`) };
  }
  return { placement: { fridge, shelf, column, depth } };
}

function conflictNote(wines: WineDoc[], p: Placement, exceptBottleId: string | null): string {
  const hit = occupancyFor(wines, p.fridge.name).find(
    (s) => s.shelf === p.shelf && s.column === p.column && s.depth === p.depth && s.bottleId !== exceptBottleId,
  );
  return hit
    ? `\n⚠️ That slot is already recorded as holding ${hit.vintage} ${hit.wineName} (bottle \`${hit.bottleId}\`). If that's stale, ask the user and relocate it with set_bottle_location.`
    : '';
}

function applyPlacement(b: BottleDoc, p: Placement): BottleDoc {
  return {
    ...b,
    cellar: p.fridge.name,
    shelf: p.shelf,
    column: p.column,
    depth: p.depth,
    section: `Shelf - ${p.shelf}`,
    row: null,
  };
}

async function saveWine(db: Firestore, wine: WineDoc): Promise<void> {
  await db.collection('wines').doc(wine.id).set(wine);
}

function locateUrl(ctx: ToolContext, wineId: string, bottleId: string): string {
  return `${ctx.baseUrl}/locate/${encodeURIComponent(wineId)}/${encodeURIComponent(bottleId)}`;
}

// ── Preference analysis ───────────────────────────────────────────────────────

interface Agg {
  n: number;
  avg: number;
}

function splitGrapes(g: string): string[] {
  return g
    .split(/,|;|\/|\band\b|&/i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 2 && !/blend/.test(s));
}

function aggregate(items: Array<[string, number]>): Record<string, Agg> {
  const acc: Record<string, { n: number; sum: number }> = {};
  for (const [k, v] of items) {
    if (!k) continue;
    acc[k] = acc[k] ?? { n: 0, sum: 0 };
    acc[k].n += 1;
    acc[k].sum += v;
  }
  return Object.fromEntries(Object.entries(acc).map(([k, { n, sum }]) => [k, { n, avg: Math.round((sum / n) * 10) / 10 }]));
}

interface Profile {
  count: number;
  avgRating: number | null;
  byProducer: Record<string, Agg>;
  byGrape: Record<string, Agg>;
  byRegion: Record<string, Agg>;
  byType: Record<string, Agg>;
  byWine: Record<string, Agg>;
  wouldBuyAgain: string[];
  loved: TastingDoc[];
  disliked: TastingDoc[];
}

function buildProfile(tastings: TastingDoc[]): Profile {
  const rated = tastings.filter((t) => typeof t.rating === 'number');
  return {
    count: tastings.length,
    avgRating: rated.length ? Math.round((rated.reduce((s, t) => s + (t.rating as number), 0) / rated.length) * 10) / 10 : null,
    byProducer: aggregate(rated.map((t) => [t.producer.toLowerCase(), t.rating as number])),
    byGrape: aggregate(rated.flatMap((t) => splitGrapes(t.grapes).map((g) => [g, t.rating as number] as [string, number]))),
    byRegion: aggregate(rated.map((t) => [(t.region || t.country).toLowerCase(), t.rating as number])),
    byType: aggregate(rated.map((t) => [normalizeWineType(t.wineType), t.rating as number])),
    byWine: aggregate(rated.map((t) => [t.wineId, t.rating as number])),
    wouldBuyAgain: [...new Set(tastings.filter((t) => t.wouldBuyAgain).map((t) => t.wineId))],
    loved: rated.filter((t) => (t.rating as number) >= 4),
    disliked: rated.filter((t) => (t.rating as number) <= 2),
  };
}

function scoreWine(w: WineDoc, p: Profile): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const st = drinkStatus(w);
  if (st === 'drink') {
    score += 2;
    reasons.push('in its drinking window');
  } else if (st === 'hold') {
    score -= 0.5;
    reasons.push('still young (hold)');
  } else if (st === 'past') {
    score -= 1;
    reasons.push('past its window — drink soon');
  } else score += 0.5;

  const prod = p.byProducer[w.producer.toLowerCase()];
  if (prod) {
    score += (prod.avg - 3) * 1.5;
    reasons.push(`you rate ${w.producer} ${prod.avg}/5 (${prod.n} tasting${prod.n === 1 ? '' : 's'})`);
  }
  const grapes = splitGrapes(w.grapes).map((g) => p.byGrape[g]).filter(Boolean) as Agg[];
  if (grapes.length) {
    const avg = grapes.reduce((s, g) => s + g.avg, 0) / grapes.length;
    score += (avg - 3) * 0.8;
    reasons.push(`grape match avg ${Math.round(avg * 10) / 10}/5`);
  }
  const region = p.byRegion[(w.region || w.country).toLowerCase()];
  if (region) {
    score += (region.avg - 3) * 0.75;
    reasons.push(`${w.region || w.country} avg ${region.avg}/5`);
  }
  const type = p.byType[normalizeWineType(w.wineType)];
  if (type) score += (type.avg - 3) * 0.4;
  const same = p.byWine[w.id];
  if (same) {
    score += (same.avg - 3) * 2;
    reasons.push(`you rated this wine ${same.avg}/5 before`);
  }
  if (p.wouldBuyAgain.includes(w.id)) {
    score += 1;
    reasons.push('flagged "would buy again"');
  }
  return { score: Math.round(score * 100) / 100, reasons };
}

function profileText(p: Profile, notes: string[]): string {
  const top = (m: Record<string, Agg>, n = 6): string =>
    Object.entries(m)
      .filter(([, a]) => a.n >= 1)
      .sort((a, b) => b[1].avg - a[1].avg || b[1].n - a[1].n)
      .slice(0, n)
      .map(([k, a]) => `${k} (${a.avg}/5, n=${a.n})`)
      .join(', ') || '—';
  return [
    `**Tastings recorded:** ${p.count}${p.avgRating != null ? ` · average rating ${p.avgRating}/5` : ''}`,
    `**Producers:** ${top(p.byProducer)}`,
    `**Grapes:** ${top(p.byGrape)}`,
    `**Regions:** ${top(p.byRegion)}`,
    `**Loved (4–5):** ${p.loved.map((t) => `${t.vintage} ${t.wineName} (${t.rating})`).join('; ') || '—'}`,
    `**Disliked (1–2):** ${p.disliked.map((t) => `${t.vintage} ${t.wineName} (${t.rating})`).join('; ') || '—'}`,
    `**Stated preferences:** ${notes.length ? notes.map((n) => `“${n}”`).join(' · ') : '— (none yet; capture them with update_preferences)'}`,
  ].join('\n');
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const listWines: ToolDef = {
  name: 'list_wines',
  description:
    'List wines in the collection with bottle counts, drink windows and fridge locations. Optional filters. By default only wines with active (unconsumed) bottles are returned.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      filter: { type: 'string', description: 'Text to match against name, producer, region, country, grape or vintage' },
      wine_type: { type: 'string', description: 'red, white, rosé, sparkling or dessert' },
      drink_now: { type: 'boolean', description: 'Only wines currently inside their drinking window' },
      fridge: { type: 'string', description: 'Only bottles stored in this fridge' },
      include_consumed: { type: 'boolean', description: 'Also include wines with no active bottles' },
    },
  },
  async handler(input, ctx) {
    const all = await getAllWines(ctx.db);
    const filter = str(input, 'filter', 'query');
    const type = normalizeWineType(str(input, 'wine_type', 'type'));
    const drinkNow = bool(input, 'drink_now');
    const fridge = str(input, 'fridge');
    const includeConsumed = bool(input, 'include_consumed') ?? false;
    let wines = all.filter((w) => includeConsumed || activeBottles(w).length > 0);
    if (filter) wines = wines.filter((w) => matchScore(w, filter) > 0);
    if (type) wines = wines.filter((w) => normalizeWineType(w.wineType) === type);
    if (drinkNow) wines = wines.filter((w) => drinkStatus(w) === 'drink');
    if (fridge) wines = wines.filter((w) => activeBottles(w).some((b) => (b.cellar || '').toLowerCase().includes(fridge.toLowerCase())));
    wines.sort((a, b) => a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name) || a.vintage - b.vintage);
    const bottles = wines.reduce((s, w) => s + activeBottles(w).length, 0);
    const summaries = wines.map(summarize);
    return {
      text: wines.length
        ? `${wines.length} wine${wines.length === 1 ? '' : 's'}, ${bottles} active bottle${bottles === 1 ? '' : 's'}:\n${wines.map(wineLine).join('\n')}`
        : 'No wines match those filters.',
      data: summaries,
      uiAction: { type: 'wine_list', wines: summaries },
    };
  },
};

const searchWines: ToolDef = {
  name: 'search_wines',
  description: 'Search the collection by name, producer, region, country, grape, type or vintage. Returns matching wines with ids.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search text' } },
    required: ['query'],
  },
  async handler(input, ctx) {
    const q = str(input, 'query', 'wine', 'filter');
    if (!q) return err('query is required');
    const all = await getAllWines(ctx.db);
    const hits = all
      .map((w) => ({ w, s: matchScore(w, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || activeBottles(b.w).length - activeBottles(a.w).length)
      .map((x) => x.w);
    const summaries = hits.map(summarize);
    return {
      text: hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'} for "${q}":\n${hits.slice(0, 25).map(wineLine).join('\n')}` : `No wines match "${q}".`,
      data: summaries,
      uiAction: hits.length ? { type: 'wine_list', wines: summaries } : undefined,
    };
  },
};

const getWineDetail: ToolDef = {
  name: 'get_wine_detail',
  description: 'Full details for one wine: every bottle with its location, prices, notes, and any tastings you have recorded for it.',
  readOnly: true,
  inputSchema: { type: 'object', properties: { wine: WINE_REF }, required: ['wine'] },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const w = r.wine;
    const tastings = (await getTastings(ctx.db)).filter((t) => t.wineId === w.id);
    const lines = [
      wineLine(w),
      `  grapes: ${w.grapes || '—'} · abv: ${w.abv || '—'} · ${w.country}${w.collectionNotes ? `\n  notes: ${w.collectionNotes}` : ''}`,
      ...w.bottles.map(bottleLine),
    ];
    if (tastings.length) {
      lines.push('  tastings:');
      for (const t of tastings) {
        lines.push(`  - ${t.tastedAt.slice(0, 10)}: ${t.rating != null ? `${t.rating}/5` : 'unrated'}${t.wouldBuyAgain ? ' · would buy again' : ''}${t.notes ? ` · ${t.notes}` : ''}`);
      }
    }
    return { text: lines.join('\n'), data: { wine: w, tastings } };
  },
};

const getCollectionStats: ToolDef = {
  name: 'get_collection_stats',
  description: 'Collection overview: bottle and label counts, market value, breakdown by type and region, wines in their peak window, fridges.',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} },
  async handler(_input, ctx) {
    const wines = await getAllWines(ctx.db);
    const fridges = await getFridges(ctx.db);
    const year = new Date().getFullYear();
    let totalBottles = 0;
    let totalValue = 0;
    let unplaced = 0;
    const byType: Record<string, number> = {};
    const byRegion: Record<string, number> = {};
    const peak: string[] = [];
    for (const w of wines) {
      const active = activeBottles(w);
      totalBottles += active.length;
      totalValue += active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
      unplaced += active.filter((b) => !shelfOf(b) || !b.column).length;
      const t = normalizeWineType(w.wineType) || 'unknown';
      byType[t] = (byType[t] ?? 0) + active.length;
      const r = w.region || w.country || 'unknown';
      byRegion[r] = (byRegion[r] ?? 0) + active.length;
      if (active.length && drinkStatus(w, year) === 'drink') peak.push(`${w.vintage} ${w.name} (${active.length})`);
    }
    const data = {
      labels: wines.filter((w) => activeBottles(w).length).length,
      totalBottles,
      totalMarketValue: Math.round(totalValue * 100) / 100,
      bottlesWithoutLocation: unplaced,
      byType,
      topRegions: Object.entries(byRegion).sort((a, b) => b[1] - a[1]).slice(0, 8),
      winesInPeakWindow: peak,
      fridges: fridges.map((f) => f.name),
    };
    return {
      text:
        `**${totalBottles} bottles** across ${data.labels} wines · est. value $${totalValue.toFixed(0)}` +
        (unplaced ? ` · ${unplaced} bottle${unplaced === 1 ? '' : 's'} without a shelf position` : '') +
        `\nBy type: ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')}` +
        `\nTop regions: ${data.topRegions.map(([k, v]) => `${k} ${v}`).join(', ')}` +
        `\nFridges: ${fridges.map((f) => f.name).join(', ')}` +
        `\nIn peak window (${peak.length}): ${peak.join('; ') || '—'}`,
      data,
    };
  },
};

const addWine: ToolDef = {
  name: 'add_wine',
  description:
    'Add bottles of a wine to the collection. If the user sent a label photo, read the name, producer, vintage, region, grapes and ABV from it. ' +
    'BEFORE calling: (1) state the wine details and ask the user to confirm/correct them; (2) ask which fridge, which shelf (counted from the top) and which position from the left it is going into — the user may answer with a photo of the shelf, in which case count the slots yourself and confirm your count; (3) ask how many bottles and the price if unknown. ' +
    'If the same wine and vintage already exists, the bottles are added to it. Bottles can be added without a location and placed later with set_bottle_location.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Wine name as on the label, e.g. "Ontogeny Red"' },
      producer: { type: 'string', description: 'Winery / producer' },
      vintage: { type: 'number', description: 'Vintage year; use 0 for non-vintage' },
      wine_type: { type: 'string', description: 'red, white, rosé, sparkling or dessert' },
      country: { type: 'string' },
      region: { type: 'string' },
      grapes: { type: 'string', description: 'Comma-separated grape varieties' },
      abv: { type: 'string', description: 'e.g. "14.5%"' },
      drink_window_start: { type: 'number' },
      drink_window_end: { type: 'number' },
      purchase_price: { type: 'number', description: 'Price paid per bottle (USD)' },
      market_price: { type: 'number', description: 'Estimated current value per bottle (USD)' },
      quantity: { type: 'number', description: 'Number of bottles (default 1)' },
      size: { type: 'string', description: 'Bottle size, default 750ml' },
      fridge: { type: 'string', description: 'Fridge name the bottle goes into, e.g. "Large Fridge"' },
      shelf: { type: 'number', description: 'Shelf number counted from the top (1 = top shelf)' },
      position: { type: 'number', description: 'Slot counted from the left (1 = leftmost). With quantity > 1 the bottles are placed side by side starting here.' },
      depth: { type: 'number', description: '1 = front (default), 2 = behind the front bottle' },
      notes: { type: 'string', description: 'Anything the user said about it (gift, occasion, where bought)' },
    },
    required: ['name', 'producer', 'vintage', 'wine_type', 'country'],
  },
  async handler(input, ctx) {
    const name = str(input, 'name');
    const producer = str(input, 'producer');
    const vintage = num(input, 'vintage') ?? 0;
    const wineType = normalizeWineType(str(input, 'wine_type', 'type'));
    const country = str(input, 'country');
    if (!name || !producer || !wineType || !country) return err('name, producer, vintage, wine_type and country are required.');
    const qty = Math.max(1, Math.min(60, Math.round(num(input, 'quantity') ?? 1)));

    const wines = await getAllWines(ctx.db);
    const placementRes = await resolvePlacement(ctx, input);
    if ('error' in placementRes) return placementRes.error;
    const placement = placementRes.placement;

    const nameSlug = slugify(name);
    let wine = wines.find((w) => w.vintage === vintage && slugify(w.name) === nameSlug);
    let created = false;
    if (!wine) {
      const base = slugify(`${producer}-${vintage || 'nv'}`);
      let id = base;
      let n = 2;
      while (wines.some((w) => w.id === id)) id = `${base}-${n++}`;
      wine = {
        id,
        name,
        vintage,
        wineType,
        grapes: str(input, 'grapes'),
        producer,
        country,
        region: str(input, 'region'),
        abv: str(input, 'abv'),
        drinkWindowStart: num(input, 'drink_window_start'),
        drinkWindowEnd: num(input, 'drink_window_end'),
        description: null,
        collectionNotes: str(input, 'notes'),
        bottles: [],
      };
      created = true;
    }

    const today = new Date().toISOString().slice(0, 10);
    const startN = wine.bottles.length + 1;
    const newBottles: BottleDoc[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < qty; i++) {
      let b: BottleDoc = {
        id: `${wine.id}-b${startN + i}`,
        cellar: '',
        size: str(input, 'size') || '750ml',
        purchasePrice: num(input, 'purchase_price'),
        marketPrice: num(input, 'market_price'),
        currency: 'USD',
        purchaseDate: today,
        location: '',
        section: '',
        shelf: null,
        row: null,
        column: null,
        depth: null,
        addedOn: nowIso(),
        personalNotes: str(input, 'notes'),
        bottleCode: '',
        barcode: '',
        consumed: false,
        consumedAt: null,
      };
      if (placement) {
        const p: Placement = { ...placement, column: placement.column + i };
        const shelfCfg = placement.fridge.shelves.find((s) => s.row === p.shelf)!;
        if (p.column > shelfCfg.cols) {
          warnings.push(`Bottle ${i + 1} would fall off the end of shelf ${p.shelf} (only ${shelfCfg.cols} positions) — left without a position; place it with set_bottle_location.`);
        } else {
          b = applyPlacement(b, p);
          const c = conflictNote([...wines.filter((w) => w.id !== wine!.id), wine], p, null);
          if (c) warnings.push(c.trim());
          wine.bottles.push(b); // so the next bottle sees this one as occupied
          newBottles.push(b);
          continue;
        }
      }
      wine.bottles.push(b);
      newBottles.push(b);
    }

    await saveWine(ctx.db, wine);
    const where = placement ? ` in ${describeLocation(newBottles[0])}${qty > 1 ? ` through position ${placement.column + qty - 1}` : ''}` : '';
    const follow = placement
      ? ''
      : `\nNo fridge position was recorded. Ask the user which fridge, shelf (from the top) and position (from the left) it went into — they can send a photo — then call set_bottle_location with wine \`${wine.id}\`.`;
    return {
      text:
        `${created ? 'Added new wine' : 'Added to existing wine'} **${wine.vintage || 'NV'} ${wine.name}** (${wine.producer}): ${qty} bottle${qty === 1 ? '' : 's'}${where}. ` +
        `Wine id \`${wine.id}\`, bottle id${qty === 1 ? '' : 's'} ${newBottles.map((b) => `\`${b.id}\``).join(', ')}. ` +
        `Now ${activeBottles(wine).length} active bottle${activeBottles(wine).length === 1 ? '' : 's'} of this wine.` +
        (warnings.length ? `\n${warnings.join('\n')}` : '') +
        follow,
      data: { wineId: wine.id, bottleIds: newBottles.map((b) => b.id), created },
    };
  },
};

const setBottleLocation: ToolDef = {
  name: 'set_bottle_location',
  description:
    'Record where a bottle physically sits: fridge, shelf (counted from the top, 1 = top) and position (counted from the left, 1 = leftmost). ' +
    'If the user sends photos of the fridge/shelf, count the shelves and slots from the photo, tell the user your reading (e.g. "shelf 8, 3rd from left") and get a confirmation before calling. ' +
    'Also use this to move a bottle.',
  inputSchema: {
    type: 'object',
    properties: {
      wine: WINE_REF,
      bottle_id: { type: 'string', description: 'Specific bottle id; if omitted, an unplaced active bottle of that wine is used' },
      fridge: { type: 'string', description: 'Fridge name' },
      shelf: { type: 'number', description: 'Shelf from the top (1 = top)' },
      position: { type: 'number', description: 'Slot from the left (1 = leftmost)' },
      depth: { type: 'number', description: '1 = front (default), 2 = back' },
    },
    required: ['wine', 'fridge', 'shelf', 'position'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const placementRes = await resolvePlacement(ctx, input);
    if ('error' in placementRes) return placementRes.error;
    if (!placementRes.placement) return err('fridge, shelf and position are required.');
    const p = placementRes.placement;
    const wine = r.wine;
    const bottleId = str(input, 'bottle_id');
    const target =
      (bottleId ? wine.bottles.find((b) => b.id === bottleId) : undefined) ??
      activeBottles(wine).find((b) => !shelfOf(b) || !b.column) ??
      activeBottles(wine)[0];
    if (!target) return err(`No active bottle of ${wine.vintage} ${wine.name} to place${bottleId ? ` (bottle "${bottleId}" not found)` : ''}.`);
    const before = describeLocation(target);
    wine.bottles = wine.bottles.map((b) => (b.id === target.id ? applyPlacement(b, p) : b));
    await saveWine(ctx.db, wine);
    const after = wine.bottles.find((b) => b.id === target.id)!;
    return {
      text: `Saved: **${wine.vintage} ${wine.name}** bottle \`${after.id}\` is now in ${describeLocation(after)} (was: ${before}).${conflictNote(r.wines, p, after.id)}`,
      data: { wineId: wine.id, bottleId: after.id, fridge: p.fridge.name, shelf: p.shelf, position: p.column, depth: p.depth },
    };
  },
};

async function renderLocation(ctx: ToolContext, wines: WineDoc[], wine: WineDoc, bottle: BottleDoc): Promise<ToolResult> {
  const fridge = (await findFridge(ctx.db, bottle.cellar)) ?? (await getFridges(ctx.db))[0];
  const shelf = shelfOf(bottle);
  const occupied = occupancyFor(wines, fridge.name).map((s) => ({ shelf: s.shelf, column: s.column }));
  const highlight = shelf && bottle.column ? { shelf, column: bottle.column } : null;
  const subtitle = highlight
    ? `Shelf ${shelf} · position ${bottle.column} from the left${(bottle.depth ?? 1) > 1 ? ' · back row' : ''}`
    : 'No shelf position recorded';
  const png = await renderFridgePng({
    fridgeName: fridge.name,
    shelves: fridge.shelves,
    occupied,
    highlight,
    title: `${wine.vintage || 'NV'} ${wine.name}`,
    subtitle,
  });
  const others = activeBottles(wine).filter((b) => b.id !== bottle.id);
  const url = locateUrl(ctx, wine.id, bottle.id);
  return {
    text:
      `**${wine.vintage || 'NV'} ${wine.name}** (${wine.producer}) — bottle \`${bottle.id}\` is in **${describeLocation(bottle)}**.` +
      (others.length ? `\nOther active bottles: ${others.map((b) => `\`${b.id}\` ${describeLocation(b)}`).join('; ')}.` : '') +
      `\nInteractive 3D view (tap to open): ${url}` +
      `\nThe image below shows ${fridge.name} with shelf ${shelf ?? '?'} pulled out and the bottle lit up.`,
    data: { wineId: wine.id, bottleId: bottle.id, fridge: fridge.name, shelf, position: bottle.column, depth: bottle.depth ?? 1, url },
    image: { data: png.toString('base64'), mimeType: 'image/png' },
    uiAction: {
      type: 'fridge_view',
      fridgeName: fridge.name,
      shelves: fridge.shelves,
      occupiedSlots: occupied.map((s) => ({ row: s.shelf, col: s.column })),
      highlight: highlight ? { row: highlight.shelf, col: highlight.column } : null,
      pulledShelf: shelf,
      wineName: wine.name,
      vintage: wine.vintage,
      url,
    },
  };
}

const locateBottle: ToolDef = {
  name: 'locate_bottle',
  description:
    'Find where a wine is stored. Returns the fridge, shelf and position, a rendered picture of the fridge with that shelf pulled out and the bottle lit up, and a link to an interactive 3D view. Use whenever the user asks where a wine is.',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { wine: WINE_REF, bottle_id: { type: 'string', description: 'Specific bottle id (optional)' } },
    required: ['wine'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const bottle = pickBottle(r.wine, str(input, 'bottle_id') || null);
    if (!bottle) return err(`No active bottles of ${r.wine.vintage} ${r.wine.name} — all consumed.`);
    if (!bottle.cellar || !shelfOf(bottle) || !bottle.column) {
      return {
        text: `${r.wine.vintage} ${r.wine.name} bottle \`${bottle.id}\` has no recorded position (${describeLocation(bottle)}). Ask the user where it is (fridge, shelf from top, position from left — a photo works) and record it with set_bottle_location.`,
        data: { wineId: r.wine.id, bottleId: bottle.id },
      };
    }
    return renderLocation(ctx, r.wines, r.wine, bottle);
  },
};

const showFridge: ToolDef = {
  name: 'show_fridge',
  description: "Render a picture of a whole fridge showing which slots are occupied, plus a shelf-by-shelf list of what's stored where. Optionally highlight one shelf.",
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      fridge: { type: 'string', description: 'Fridge name (defaults to the only/first fridge)' },
      shelf: { type: 'number', description: 'Shelf to pull out / focus on (optional)' },
    },
  },
  async handler(input, ctx) {
    const fridges = await getFridges(ctx.db);
    const fridge = (str(input, 'fridge') ? await findFridge(ctx.db, str(input, 'fridge')) : null) ?? fridges[0];
    const wines = await getAllWines(ctx.db);
    const slots = occupancyFor(wines, fridge.name);
    const focus = num(input, 'shelf');
    const lines: string[] = [];
    for (const sh of [...fridge.shelves].sort((a, b) => a.row - b.row)) {
      const here = slots.filter((s) => s.shelf === sh.row).sort((a, b) => a.column - b.column || a.depth - b.depth);
      lines.push(
        `shelf ${sh.row} (${sh.cols} across): ` +
          (here.length ? here.map((s) => `[${s.column}${s.depth > 1 ? 'b' : ''}] ${s.vintage} ${s.wineName}`).join(', ') : 'empty'),
      );
    }
    const unplaced = wines.flatMap((w) => activeBottles(w).filter((b) => (b.cellar || '').toLowerCase() === fridge.name.toLowerCase() && (!shelfOf(b) || !b.column)).map((b) => `${w.vintage} ${w.name} (\`${b.id}\`)`));
    const png = await renderFridgePng({
      fridgeName: fridge.name,
      shelves: fridge.shelves,
      occupied: slots.map((s) => ({ shelf: s.shelf, column: s.column })),
      highlight: focus ? { shelf: focus, column: -1 } : null,
      title: fridge.model || fridge.name,
      subtitle: `${slots.length} bottles placed${focus ? ` · shelf ${focus} pulled out` : ''}`,
    });
    return {
      text: `**${fridge.name}**${fridge.model ? ` (${fridge.model})` : ''}\n${lines.join('\n')}` + (unplaced.length ? `\nIn this fridge but no shelf recorded: ${unplaced.join(', ')}` : ''),
      data: { fridge, slots },
      image: { data: png.toString('base64'), mimeType: 'image/png' },
      uiAction: {
        type: 'fridge_view',
        fridgeName: fridge.name,
        shelves: fridge.shelves,
        occupiedSlots: slots.map((s) => ({ row: s.shelf, col: s.column })),
        highlight: null,
        pulledShelf: focus,
        wineName: '',
        vintage: 0,
      },
    };
  },
};

const markConsumed: ToolDef = {
  name: 'mark_consumed',
  description:
    'Mark a bottle as drunk — it leaves the active inventory and frees its slot. Confirm which wine first if ambiguous. ' +
    'AFTER this succeeds, always ask the user how the wine was — a 1–5 rating, what they liked or disliked, and whether they would buy it again — and record the answer with rate_wine.',
  inputSchema: {
    type: 'object',
    properties: {
      wine: WINE_REF,
      bottle_id: { type: 'string', description: 'Specific bottle id; if omitted the most recently added active bottle is used' },
    },
    required: ['wine'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const wine = r.wine;
    const active = activeBottles(wine);
    if (!active.length) return err(`All bottles of ${wine.vintage} ${wine.name} are already marked consumed.`);
    const bottleId = str(input, 'bottle_id');
    const target = bottleId ? active.find((b) => b.id === bottleId) : active[active.length - 1];
    if (!target) return err(`Bottle "${bottleId}" is not an active bottle of ${wine.vintage} ${wine.name}. Active: ${active.map((b) => b.id).join(', ')}.`);
    const where = describeLocation(target);
    wine.bottles = wine.bottles.map((b) => (b.id === target.id ? { ...b, consumed: true, consumedAt: nowIso() } : b));
    await saveWine(ctx.db, wine);
    const remaining = activeBottles(wine).length;
    return {
      text:
        `Marked **${wine.vintage} ${wine.name}** bottle \`${target.id}\` (${where}) as consumed. ${remaining} bottle${remaining === 1 ? '' : 's'} remaining.` +
        `\nNext: ask the user how it was (rating 1–5, likes/dislikes, buy again?) and call rate_wine with wine \`${wine.id}\` and bottle_id \`${target.id}\`.`,
      data: { wineId: wine.id, bottleId: target.id, remaining },
    };
  },
};

const rateWine: ToolDef = {
  name: 'rate_wine',
  description:
    "Record the user's impression of a wine they drank: rating 1–5, free-text likes/dislikes, and whether they'd buy it again. These tastings drive recommend_wine. Usually called right after mark_consumed.",
  inputSchema: {
    type: 'object',
    properties: {
      wine: WINE_REF,
      bottle_id: { type: 'string' },
      rating: { type: 'number', description: '1 = disliked … 5 = loved' },
      liked: { type: 'boolean', description: 'Simple thumbs up/down if no numeric rating was given' },
      notes: { type: 'string', description: 'What they said about it, in their words' },
      would_buy_again: { type: 'boolean' },
    },
    required: ['wine'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const wine = r.wine;
    let rating = num(input, 'rating');
    const liked = bool(input, 'liked');
    if (rating != null) rating = Math.max(1, Math.min(5, Math.round(rating * 2) / 2));
    if (rating == null && liked != null) rating = liked ? 4 : 2;
    if (rating == null && !str(input, 'notes')) return err('Give at least a rating (1–5), liked true/false, or notes.');
    const id = `${wine.id}-${Date.now().toString(36)}`;
    const doc: TastingDoc = {
      id,
      wineId: wine.id,
      bottleId: str(input, 'bottle_id') || null,
      wineName: wine.name,
      vintage: wine.vintage,
      producer: wine.producer,
      wineType: wine.wineType,
      grapes: wine.grapes,
      region: wine.region,
      country: wine.country,
      rating,
      liked: liked ?? (rating != null ? rating >= 3.5 : null),
      notes: str(input, 'notes'),
      wouldBuyAgain: bool(input, 'would_buy_again'),
      tastedAt: nowIso(),
    };
    await ctx.db.collection('tastings').doc(id).set(doc);
    const remaining = activeBottles(wine).length;
    return {
      text:
        `Recorded: **${wine.vintage} ${wine.name}** — ${rating != null ? `${rating}/5` : liked ? 'liked' : 'not a fan'}${doc.wouldBuyAgain === true ? ', would buy again' : doc.wouldBuyAgain === false ? ', would not buy again' : ''}${doc.notes ? ` — “${doc.notes}”` : ''}.` +
        (remaining ? ` ${remaining} bottle${remaining === 1 ? '' : 's'} of it left.` : ' None left in the cellar.') +
        ` If the user stated a general preference (e.g. "I prefer less oak"), save it with update_preferences.`,
      data: doc,
    };
  },
};

const getPrefs: ToolDef = {
  name: 'get_preferences',
  description: "The user's taste profile: stated preferences plus statistics from every tasting recorded (favourite producers, grapes, regions; loved and disliked wines). Use before recommending.",
  readOnly: true,
  inputSchema: { type: 'object', properties: {} },
  async handler(_input, ctx) {
    const [tastings, prefs] = await Promise.all([getTastings(ctx.db), getPreferences(ctx.db)]);
    const profile = buildProfile(tastings);
    return { text: profileText(profile, prefs.notes), data: { profile, notes: prefs.notes, tastings } };
  },
};

const updatePrefs: ToolDef = {
  name: 'update_preferences',
  description: 'Save a general taste preference the user states ("I love big Napa cabs", "no oaky chardonnay"), or remove an outdated one.',
  inputSchema: {
    type: 'object',
    properties: {
      add: { type: 'string', description: 'Preference to add, phrased as the user said it' },
      remove_containing: { type: 'string', description: 'Remove existing preference notes containing this text' },
    },
  },
  async handler(input, ctx) {
    const prefs = await getPreferences(ctx.db);
    const add = str(input, 'add', 'note', 'preference');
    const remove = str(input, 'remove_containing', 'remove');
    let notes = [...prefs.notes];
    if (remove) notes = notes.filter((n) => !n.toLowerCase().includes(remove.toLowerCase()));
    if (add && !notes.some((n) => n.toLowerCase() === add.toLowerCase())) notes.push(add);
    if (!add && !remove) return err('Pass `add` and/or `remove_containing`.');
    await ctx.db.collection('preferences').doc('owner').set({ notes, updatedAt: nowIso() });
    return { text: `Preferences now: ${notes.length ? notes.map((n) => `“${n}”`).join(' · ') : '(none)'}`, data: { notes } };
  },
};

const recommendWine: ToolDef = {
  name: 'recommend_wine',
  description:
    "Suggest bottles from the cellar to open, ranked using the user's ratings, stated preferences and drink windows. Pass the occasion/food so you can explain the choice. Only wines with active bottles are considered.",
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      occasion: { type: 'string', description: 'e.g. "steak dinner", "gift", "Tuesday night"' },
      wine_type: { type: 'string', description: 'Restrict to red/white/rosé/sparkling/dessert' },
      count: { type: 'number', description: 'How many suggestions (default 3)' },
    },
  },
  async handler(input, ctx) {
    const [wines, tastings, prefs] = await Promise.all([getAllWines(ctx.db), getTastings(ctx.db), getPreferences(ctx.db)]);
    const profile = buildProfile(tastings);
    const type = normalizeWineType(str(input, 'wine_type', 'type'));
    const count = Math.max(1, Math.min(10, Math.round(num(input, 'count') ?? 3)));
    const ranked = wines
      .filter((w) => activeBottles(w).length > 0 && (!type || normalizeWineType(w.wineType) === type))
      .map((w) => ({ w, ...scoreWine(w, profile) }))
      .sort((a, b) => b.score - a.score || (b.w.drinkWindowEnd ?? 9999) - (a.w.drinkWindowEnd ?? 9999));
    const picks = ranked.slice(0, count);
    const occasion = str(input, 'occasion');
    return {
      text:
        `Top ${picks.length} for ${occasion || 'tonight'} (score = fit with the user's ratings + drink window):\n` +
        picks.map((p, i) => `${i + 1}. ${wineLine(p.w)}\n   score ${p.score} — ${p.reasons.join('; ') || 'no tasting history yet'}`).join('\n') +
        `\n\n${profileText(profile, prefs.notes)}` +
        `\n\nPresent 1–3 of these with a short reason each and mention the fridge location; ask if they want it located (locate_bottle).`,
      data: { picks: picks.map((p) => ({ wine: summarize(p.w), score: p.score, reasons: p.reasons })), notes: prefs.notes },
      uiAction: { type: 'wine_list', wines: picks.map((p) => summarize(p.w)) },
    };
  },
};

const listFridges: ToolDef = {
  name: 'list_fridges',
  description: 'List the registered wine fridges with their shelf layouts and how full each is.',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} },
  async handler(_input, ctx) {
    const [fridges, wines] = await Promise.all([getFridges(ctx.db), getAllWines(ctx.db)]);
    const lines = fridges.map((f) => {
      const occ = occupancyFor(wines, f.name);
      const shelfLines = f.shelves
        .slice()
        .sort((a, b) => a.row - b.row)
        .map((s) => `${s.row}:${occ.filter((o) => o.shelf === s.row).length}/${s.cols}${s.isDisplay ? '*' : ''}`)
        .join('  ');
      return `${fridgeSummaryLine(f, occ.length)}\n  shelf:used/slots → ${shelfLines}${f.notes ? `\n  ${f.notes}` : ''}`;
    });
    return { text: lines.join('\n') + '\n(* = display shelf)', data: fridges };
  },
};

const saveFridge: ToolDef = {
  name: 'save_fridge',
  description:
    'Register a new wine fridge or update its layout. When the user sends a photo of a fridge: count the shelves from top to bottom and how many bottles fit across each shelf (display/angled shelves usually hold fewer), state your count and ask the user to confirm or correct it, THEN call this. ' +
    'Give either `shelves` (per-shelf detail) or `shelf_count` + `bottles_per_shelf` for a uniform layout.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Fridge name the user will refer to, e.g. "Small Fridge"' },
      model: { type: 'string', description: 'Make/model if visible' },
      shelves: {
        type: 'array',
        description: 'Per-shelf layout, top shelf first',
        items: {
          type: 'object',
          properties: {
            row: { type: 'number', description: 'Shelf number from the top (1 = top)' },
            cols: { type: 'number', description: 'Bottles across' },
            depth: { type: 'number', description: 'Bottles deep (default 1)' },
            isDisplay: { type: 'boolean', description: 'Display/angled shelf' },
          },
          required: ['row', 'cols'],
        },
      },
      shelf_count: { type: 'number' },
      bottles_per_shelf: { type: 'number' },
      notes: { type: 'string', description: 'Where it is in the house, temperature zones, etc.' },
    },
    required: ['name'],
  },
  async handler(input, ctx) {
    const name = str(input, 'name');
    if (!name) return err('name is required.');
    let shelves: FridgeShelfDoc[] = [];
    if (Array.isArray(input.shelves) && input.shelves.length) {
      shelves = (input.shelves as Array<Record<string, unknown>>)
        .map((s, i) => ({
          row: Math.round(num(s, 'row') ?? i + 1),
          cols: Math.max(1, Math.round(num(s, 'cols', 'columns', 'bottles') ?? 1)),
          ...(num(s, 'depth') ? { depth: Math.round(num(s, 'depth')!) } : {}),
          ...(bool(s, 'isDisplay') ? { isDisplay: true } : {}),
        }))
        .sort((a, b) => a.row - b.row);
    } else {
      const n = Math.round(num(input, 'shelf_count') ?? 0);
      const c = Math.round(num(input, 'bottles_per_shelf') ?? 0);
      if (n < 1 || c < 1) return err('Provide `shelves` or both `shelf_count` and `bottles_per_shelf`.');
      shelves = Array.from({ length: n }, (_, i) => ({ row: i + 1, cols: c }));
    }
    const existing = await findFridge(ctx.db, name);
    const id = existing?.id ?? slugify(name);
    const doc: FridgeDoc = {
      id,
      name: existing?.name ?? name,
      model: str(input, 'model') || existing?.model || '',
      shelves,
      ...(str(input, 'notes') || existing?.notes ? { notes: str(input, 'notes') || existing?.notes } : {}),
    };
    await ctx.db.collection('fridges').doc(id).set(doc);
    const slots = shelves.reduce((s, sh) => s + sh.cols * (sh.depth ?? 1), 0);
    return {
      text: `${existing ? 'Updated' : 'Registered'} fridge **${doc.name}**: ${shelves.length} shelves, ${slots} slots (${shelves.map((s) => s.cols).join('/')} across, top to bottom). Bottles can now be placed with add_wine or set_bottle_location using fridge "${doc.name}".`,
      data: doc,
    };
  },
};

const updateBottlePrice: ToolDef = {
  name: 'update_bottle_price',
  description: 'Set the purchase price or current market value of a bottle (or of every active bottle of the wine).',
  inputSchema: {
    type: 'object',
    properties: {
      wine: WINE_REF,
      bottle_id: { type: 'string', description: 'Specific bottle; omit to apply to all active bottles of the wine' },
      price: { type: 'number' },
      kind: { type: 'string', description: '"purchase" (default) or "market"' },
      currency: { type: 'string', description: 'Default USD' },
    },
    required: ['wine', 'price'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const price = num(input, 'price');
    if (price == null) return err('price is required.');
    const kind = /market|value/i.test(str(input, 'kind')) ? 'market' : 'purchase';
    const currency = str(input, 'currency') || 'USD';
    const bottleId = str(input, 'bottle_id');
    let n = 0;
    r.wine.bottles = r.wine.bottles.map((b) => {
      if (bottleId ? b.id !== bottleId : b.consumed) return b;
      n++;
      return kind === 'market' ? { ...b, marketPrice: price, currency } : { ...b, purchasePrice: price, currency };
    });
    if (!n) return err(bottleId ? `Bottle "${bottleId}" not found.` : 'No active bottles.');
    await saveWine(ctx.db, r.wine);
    return { text: `Set ${kind} price ${currency} ${price.toFixed(2)} on ${n} bottle${n === 1 ? '' : 's'} of ${r.wine.vintage} ${r.wine.name}.`, data: { wineId: r.wine.id, updated: n } };
  },
};

const addWineNotes: ToolDef = {
  name: 'add_wine_notes',
  description: 'Add a note to a wine (who gave it, where it was bought, plans for it). Appends by default.',
  inputSchema: {
    type: 'object',
    properties: {
      wine: WINE_REF,
      notes: { type: 'string' },
      replace: { type: 'boolean', description: 'Replace existing notes instead of appending' },
    },
    required: ['wine', 'notes'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const notes = str(input, 'notes');
    if (!notes) return err('notes is required.');
    const replace = bool(input, 'replace') ?? false;
    r.wine.collectionNotes = replace || !r.wine.collectionNotes ? notes : `${r.wine.collectionNotes}\n${notes}`;
    await saveWine(ctx.db, r.wine);
    return { text: `Notes for ${r.wine.vintage} ${r.wine.name}: ${r.wine.collectionNotes}`, data: { wineId: r.wine.id } };
  },
};

const removeBottle: ToolDef = {
  name: 'remove_bottle',
  description: 'Permanently delete a bottle record that was added by mistake (NOT for drinking a bottle — use mark_consumed for that). Confirm with the user first.',
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: { wine: WINE_REF, bottle_id: { type: 'string', description: 'Bottle id to delete' } },
    required: ['wine', 'bottle_id'],
  },
  async handler(input, ctx) {
    const r = await resolveWine(ctx, input);
    if ('error' in r) return r.error;
    const bottleId = str(input, 'bottle_id');
    const target = r.wine.bottles.find((b) => b.id === bottleId);
    if (!target) return err(`Bottle "${bottleId}" not found on ${r.wine.vintage} ${r.wine.name}. Bottles: ${r.wine.bottles.map((b) => b.id).join(', ')}.`);
    r.wine.bottles = r.wine.bottles.filter((b) => b.id !== bottleId);
    if (r.wine.bottles.length === 0) {
      await ctx.db.collection('wines').doc(r.wine.id).delete();
      return { text: `Deleted bottle \`${bottleId}\` — it was the last record, so the wine ${r.wine.vintage} ${r.wine.name} was removed from the collection.`, data: { wineId: r.wine.id, wineDeleted: true } };
    }
    await saveWine(ctx.db, r.wine);
    return { text: `Deleted bottle \`${bottleId}\` of ${r.wine.vintage} ${r.wine.name}. ${activeBottles(r.wine).length} active bottle(s) remain.`, data: { wineId: r.wine.id, wineDeleted: false } };
  },
};

export const TOOLS: ToolDef[] = [
  listWines,
  searchWines,
  getWineDetail,
  getCollectionStats,
  locateBottle,
  showFridge,
  addWine,
  setBottleLocation,
  markConsumed,
  rateWine,
  recommendWine,
  getPrefs,
  updatePrefs,
  listFridges,
  saveFridge,
  updateBottlePrice,
  addWineNotes,
  removeBottle,
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) return err(`Unknown tool: ${name}`);
  try {
    return await tool.handler(input ?? {}, ctx);
  } catch (e) {
    console.error(`tool ${name} failed`, e);
    return err(`The ${name} tool failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
