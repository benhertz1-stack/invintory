/**
 * Dev utility: render a sample fridge PNG to check the server-side image.
 *   npx tsx scripts/render-preview.ts out.png
 */
import { writeFileSync } from 'fs';
import { renderFridgePng } from '../server/render';
import { WHYNTER_SHELVES } from '../server/db';

const occupied = [
  { shelf: 1, column: 2 }, { shelf: 1, column: 5 },
  { shelf: 3, column: 1 }, { shelf: 3, column: 2 }, { shelf: 3, column: 3 }, { shelf: 3, column: 7 },
  { shelf: 8, column: 1 }, { shelf: 8, column: 2 }, { shelf: 8, column: 3 }, { shelf: 8, column: 5 }, { shelf: 8, column: 9 },
  { shelf: 10, column: 5 }, { shelf: 13, column: 4 }, { shelf: 13, column: 6 }, { shelf: 16, column: 1 },
];

(async () => {
  const png = await renderFridgePng({
    fridgeName: 'Large Fridge',
    shelves: WHYNTER_SHELVES,
    occupied,
    highlight: { shelf: 8, column: 3 },
    title: '2019 Bevan Cellars Ontogeny Red',
    subtitle: 'Shelf 8 · position 3 from the left',
  });
  const out = process.argv[2] || 'fridge-preview.png';
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
})();
