import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';

// ── Firestore singleton ───────────────────────────────────────────────────────

let _db: Firestore | null = null;

export function getDb(): Firestore {
  if (!_db) {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'invintory-495823' });
    }
    _db = admin.firestore();
  }
  return _db;
}

// ── Document types ────────────────────────────────────────────────────────────

export interface BottleDoc {
  id: string;
  /** Fridge / cellar display name, e.g. "Large Fridge". */
  cellar: string;
  size: string;
  purchasePrice: number | null;
  marketPrice: number | null;
  currency: string;
  purchaseDate: string;
  /** Legacy free-text location (from CSV import). */
  location: string;
  /** Legacy "Shelf - N" text (from CSV import). */
  section: string;
  /** Canonical shelf number counted from the top (1 = top shelf). */
  shelf: number | null;
  /** Legacy row value from the CSV import; not used for placement. */
  row: number | null;
  /** Position on the shelf counted from the left (1 = leftmost). */
  column: number | null;
  /** 1 = front, 2 = behind the front bottle. */
  depth: number | null;
  addedOn: string;
  personalNotes: string;
  bottleCode: string;
  barcode: string;
  consumed: boolean;
  consumedAt?: string | null;
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
  /** Set by the monthly report when market prices were refreshed from the web. */
  priceCheckedAt?: string;
  priceSource?: string;
  priceConfidence?: string;
}

export interface FridgeShelfDoc {
  /** Shelf number from the top (1 = top). */
  row: number;
  /** Bottle positions across the shelf. */
  cols: number;
  /** Display / presentation shelf (bottles standing or angled). */
  isDisplay?: boolean;
  /** How many bottles deep (default 1). */
  depth?: number;
}

export interface FridgeDoc {
  id: string;
  name: string;
  model: string;
  shelves: FridgeShelfDoc[];
  notes?: string;
}

export interface TastingDoc {
  id: string;
  wineId: string;
  bottleId: string | null;
  wineName: string;
  vintage: number;
  producer: string;
  wineType: string;
  grapes: string;
  region: string;
  country: string;
  /** 1 (disliked) … 5 (loved). */
  rating: number | null;
  liked: boolean | null;
  notes: string;
  wouldBuyAgain: boolean | null;
  tastedAt: string;
}

export interface PreferencesDoc {
  /** Free-text preference statements, newest last. */
  notes: string[];
  updatedAt: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const WHYNTER_SHELVES: FridgeShelfDoc[] = [
  { row: 1, cols: 6, isDisplay: true },
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((r) => ({ row: r, cols: 11 })),
  { row: 15, cols: 6 },
  { row: 16, cols: 6 },
];

export const DEFAULT_FRIDGE: FridgeDoc = {
  id: 'large-fridge',
  name: 'Large Fridge',
  model: 'Whynter EJh1162',
  shelves: WHYNTER_SHELVES,
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeWineType(t: string | undefined | null): string {
  const s = (t ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('ros')) return 'rosé';
  if (s.startsWith('spark') || s.includes('champagne')) return 'sparkling';
  if (s.startsWith('dess') || s.includes('port') || s.includes('sweet')) return 'dessert';
  if (s.startsWith('white')) return 'white';
  if (s.startsWith('red')) return 'red';
  return s;
}

/** Canonical shelf number for a bottle, falling back to legacy fields. */
export function shelfOf(b: BottleDoc): number | null {
  if (typeof b.shelf === 'number' && b.shelf > 0) return b.shelf;
  const m =
    /shelf\s*-?\s*(\d+)/i.exec(b.section || '') || /shelf\s*-?\s*(\d+)/i.exec(b.location || '');
  if (m) return parseInt(m[1], 10);
  if (typeof b.row === 'number' && b.row > 1) return b.row;
  return null;
}

export function activeBottles(w: WineDoc): BottleDoc[] {
  return (w.bottles ?? []).filter((b) => !b.consumed);
}

export function describeLocation(b: BottleDoc): string {
  const parts: string[] = [];
  if (b.cellar) parts.push(b.cellar);
  const s = shelfOf(b);
  if (s) parts.push(`shelf ${s}`);
  if (b.column) parts.push(`position ${b.column} from left`);
  if (b.depth && b.depth > 1) parts.push('back row');
  return parts.length ? parts.join(', ') : 'no location recorded';
}

export type DrinkStatus = 'drink' | 'hold' | 'past' | 'unknown';

export function drinkStatus(w: Pick<WineDoc, 'drinkWindowStart' | 'drinkWindowEnd'>, year = new Date().getFullYear()): DrinkStatus {
  if (!w.drinkWindowStart || !w.drinkWindowEnd) return 'unknown';
  if (year < w.drinkWindowStart) return 'hold';
  if (year > w.drinkWindowEnd) return 'past';
  return 'drink';
}

export interface WineSummary {
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
  drinkStatus: DrinkStatus;
  bottleCount: number;
  marketValue: number;
  hasDescription: boolean;
  collectionNotes: string;
  locations: string[];
}

export function summarize(d: WineDoc): WineSummary {
  const active = activeBottles(d);
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
    drinkStatus: drinkStatus(d),
    bottleCount: active.length,
    marketValue: active.reduce((s, b) => s + (b.marketPrice ?? 0), 0),
    hasDescription: !!d.description,
    collectionNotes: d.collectionNotes || '',
    locations: [...new Set(active.map(describeLocation))],
  };
}

/** Pick a bottle for an operation: by id, else the first active one (preferring one with a location). */
export function pickBottle(w: WineDoc, bottleId?: string | null): BottleDoc | undefined {
  const active = activeBottles(w);
  if (bottleId) return active.find((b) => b.id === bottleId) ?? w.bottles.find((b) => b.id === bottleId);
  return active.find((b) => shelfOf(b) != null) ?? active[0];
}

/** Score a wine against a free-text query; 0 = no match. */
export function matchScore(w: WineDoc, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const hay = [w.name, w.producer, w.region, w.country, w.grapes, w.wineType, String(w.vintage)]
    .join(' ')
    .toLowerCase();
  if (hay.includes(q)) return 100;
  const tokens = q.split(/[\s,]+/).filter((t) => t.length > 1);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  if (hits === 0) return 0;
  return Math.round((hits / tokens.length) * 90);
}

// ── Firestore access ──────────────────────────────────────────────────────────

export async function getAllWines(db: Firestore): Promise<WineDoc[]> {
  const snap = await db.collection('wines').get();
  return snap.docs.map((d) => d.data() as WineDoc);
}

export async function getWineById(db: Firestore, id: string): Promise<WineDoc | null> {
  const doc = await db.collection('wines').doc(id).get();
  return doc.exists ? (doc.data() as WineDoc) : null;
}

/** Find wines by id or fuzzy text. Returns matches sorted by score, active-bottle wines first. */
export async function findWines(db: Firestore, idOrQuery: string, wines?: WineDoc[]): Promise<WineDoc[]> {
  const byId = await getWineById(db, idOrQuery);
  if (byId) return [byId];
  const all = wines ?? (await getAllWines(db));
  return all
    .map((w) => ({ w, s: matchScore(w, idOrQuery) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || activeBottles(b.w).length - activeBottles(a.w).length)
    .map((x) => x.w);
}

export async function getFridges(db: Firestore): Promise<FridgeDoc[]> {
  const snap = await db.collection('fridges').get();
  const list = snap.docs.map((d) => d.data() as FridgeDoc);
  return list.length ? list : [DEFAULT_FRIDGE];
}

export async function findFridge(db: Firestore, nameOrId: string): Promise<FridgeDoc | null> {
  const key = (nameOrId ?? '').trim().toLowerCase();
  if (!key) return null;
  const fridges = await getFridges(db);
  return (
    fridges.find((f) => f.id === key || f.name.toLowerCase() === key) ??
    fridges.find((f) => f.id === slugify(key)) ??
    fridges.find((f) => f.name.toLowerCase().includes(key) || key.includes(f.name.toLowerCase())) ??
    null
  );
}

export interface OccupiedSlot {
  shelf: number;
  column: number;
  depth: number;
  wineId: string;
  wineName: string;
  vintage: number;
  bottleId: string;
}

/** All active bottles with a shelf+column in the given fridge. */
export function occupancyFor(wines: WineDoc[], fridgeName: string): OccupiedSlot[] {
  const key = fridgeName.trim().toLowerCase();
  const slots: OccupiedSlot[] = [];
  for (const w of wines) {
    for (const b of activeBottles(w)) {
      if ((b.cellar ?? '').trim().toLowerCase() !== key) continue;
      const shelf = shelfOf(b);
      if (!shelf || !b.column) continue;
      slots.push({
        shelf,
        column: b.column,
        depth: b.depth ?? 1,
        wineId: w.id,
        wineName: w.name,
        vintage: w.vintage,
        bottleId: b.id,
      });
    }
  }
  return slots;
}

export async function getTastings(db: Firestore): Promise<TastingDoc[]> {
  const snap = await db.collection('tastings').orderBy('tastedAt', 'desc').get();
  return snap.docs.map((d) => d.data() as TastingDoc);
}

export async function getPreferences(db: Firestore): Promise<PreferencesDoc> {
  const doc = await db.collection('preferences').doc('owner').get();
  return doc.exists ? (doc.data() as PreferencesDoc) : { notes: [], updatedAt: '' };
}

export function nowIso(): string {
  return new Date().toISOString();
}
