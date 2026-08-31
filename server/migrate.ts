import 'dotenv/config';
import type { Firestore } from 'firebase-admin/firestore';
import { type BottleDoc, type WineDoc, getDb, shelfOf } from './db';

/**
 * Idempotent data migrations, tracked in meta/migrations.
 *
 * v1 — shelfFromSection: the CSV import stored the shelf number as
 *      section "Shelf - N" with row = 1 for every bottle. Populate the
 *      canonical `shelf` field so placement / rendering works.
 */
export async function runMigrations(db: Firestore): Promise<string[]> {
  const applied: string[] = [];
  const metaRef = db.collection('meta').doc('migrations');
  const meta = ((await metaRef.get()).data() ?? {}) as Record<string, unknown>;

  if (!meta.shelfFromSection_v1) {
    const snap = await db.collection('wines').get();
    let changed = 0;
    let batch = db.batch();
    let inBatch = 0;
    for (const doc of snap.docs) {
      const wine = doc.data() as WineDoc;
      let dirty = false;
      const bottles: BottleDoc[] = (wine.bottles ?? []).map((b) => {
        const shelf = shelfOf(b);
        const next: BottleDoc = {
          ...b,
          shelf: typeof b.shelf === 'number' && b.shelf > 0 ? b.shelf : shelf,
          consumedAt: b.consumedAt ?? null,
        };
        if (next.shelf !== b.shelf || next.consumedAt !== b.consumedAt || b.shelf === undefined) dirty = true;
        return next;
      });
      if (dirty) {
        batch.update(doc.ref, { bottles });
        changed++;
        inBatch++;
        if (inBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          inBatch = 0;
        }
      }
    }
    if (inBatch) await batch.commit();
    await metaRef.set({ ...meta, shelfFromSection_v1: new Date().toISOString(), shelfFromSection_v1_wines: changed }, { merge: true });
    applied.push(`shelfFromSection_v1 (${changed} wines updated)`);
  }

  return applied;
}

if (require.main === module) {
  runMigrations(getDb())
    .then((applied) => {
      console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to migrate.');
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
