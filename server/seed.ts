import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import type { Firestore } from 'firebase-admin/firestore';
import { type BottleDoc, type WineDoc, DEFAULT_FRIDGE, slugify } from './db';

/** One-time import of server/data/collection.csv into an empty Firestore. */

function parseNum(s: string | undefined): number | null {
  const n = parseFloat(s ?? '');
  return Number.isNaN(n) ? null : n;
}

function parseInt2(s: string | undefined): number | null {
  const n = parseInt(s ?? '', 10);
  return Number.isNaN(n) ? null : n;
}

function shelfFromText(...texts: Array<string | undefined>): number | null {
  for (const t of texts) {
    const m = /shelf\s*-?\s*(\d+)/i.exec(t ?? '');
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

export async function seedIfEmpty(db: Firestore): Promise<void> {
  const snap = await db.collection('wines').limit(1).get();
  if (!snap.empty) return;

  const csvPath = path.join(process.cwd(), 'server', 'data', 'collection.csv');
  if (!existsSync(csvPath)) {
    console.log('No wines in Firestore and no seed CSV found — starting empty.');
    return;
  }
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
        wineType: row['Wine Type']?.trim().toLowerCase() ?? '',
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
    const bottleId = row['Bottle Code']?.trim() || row['Barcode']?.trim() || `${wine.id}-b${wine.bottles.length + 1}`;
    const section = row['Section Name']?.trim() ?? '';
    const location = row['Custom Bottle Location']?.trim() ?? '';
    const bottle: BottleDoc = {
      id: bottleId,
      cellar: row['Cellar or Fridge Name']?.trim() || DEFAULT_FRIDGE.name,
      size: row['Size']?.trim() || '750ml',
      purchasePrice: parseNum(row['Purchase Price']),
      marketPrice: parseNum(row['Market Price (USD)']),
      currency: row['Currency']?.trim() || 'USD',
      purchaseDate: row['Purchase Date']?.trim() ?? '',
      location,
      section,
      shelf: shelfFromText(section, location),
      row: parseInt2(row['Row']),
      column: parseInt2(row['Column']),
      depth: parseInt2(row['Depth']),
      addedOn: row['Added On']?.trim() ?? '',
      personalNotes: row['Personal Notes']?.trim() ?? '',
      bottleCode: row['Bottle Code']?.trim() ?? '',
      barcode: row['Barcode']?.trim() ?? '',
      consumed: false,
      consumedAt: null,
    };
    wine.bottles.push(bottle);
  }

  const wines = [...wineMap.values()];
  for (let i = 0; i < wines.length; i += 400) {
    const batch = db.batch();
    for (const wine of wines.slice(i, i + 400)) batch.set(db.collection('wines').doc(wine.id), wine);
    await batch.commit();
  }
  console.log(`Seeded ${wines.length} wines (${rows.length} bottles) from CSV.`);
}

export async function seedFridges(db: Firestore): Promise<void> {
  const snap = await db.collection('fridges').limit(1).get();
  if (!snap.empty) return;
  await db.collection('fridges').doc(DEFAULT_FRIDGE.id).set(DEFAULT_FRIDGE);
  console.log(`Seeded fridge "${DEFAULT_FRIDGE.name}".`);
}
