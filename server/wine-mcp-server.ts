import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Firestore } from 'firebase-admin/firestore';
import type { WineDoc } from './index';

export function createWineMcpServer(db: Firestore): Server {
  const server = new Server(
    { name: 'wine-inventory', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_wines',
        description:
          'List all wines in the collection with key details: producer, name, vintage, type, region, bottle count, drink window, and market value.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'search_wines',
        description: 'Search wines by name, producer, region, country, grape variety, or vintage year.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query string' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_wine_detail',
        description:
          'Get complete details for a specific wine including all individual bottles with locations and prices.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Wine ID (slug, e.g. "gramercy-cellars-lagniappe-2019")',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'get_collection_stats',
        description:
          'Get overall collection statistics: total bottles, total value, breakdown by type and region, wines currently in peak drinking window.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'mark_bottle_consumed',
        description: 'Mark a specific bottle as consumed/drunk.',
        inputSchema: {
          type: 'object',
          properties: {
            wine_id: { type: 'string', description: 'Wine ID' },
            bottle_id: { type: 'string', description: 'Bottle ID (bottle code or barcode)' },
          },
          required: ['wine_id', 'bottle_id'],
        },
      },
      {
        name: 'update_bottle_price',
        description: 'Set or update the purchase price for a specific bottle.',
        inputSchema: {
          type: 'object',
          properties: {
            wine_id: { type: 'string', description: 'Wine ID' },
            bottle_id: { type: 'string', description: 'Bottle ID' },
            price: { type: 'number', description: 'Purchase price as a number' },
            currency: {
              type: 'string',
              description: 'Currency code (default USD)',
              enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'],
            },
          },
          required: ['wine_id', 'bottle_id', 'price'],
        },
      },
      {
        name: 'add_wine_notes',
        description:
          'Add or update personal collection notes for a wine (tasting impressions, when opened, gift from, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            wine_id: { type: 'string', description: 'Wine ID' },
            notes: { type: 'string', description: 'Notes to save for this wine' },
          },
          required: ['wine_id', 'notes'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'list_wines') {
      const snap = await db.collection('wines').get();
      const wines = snap.docs.map((doc) => {
        const d = doc.data() as WineDoc;
        const active = d.bottles.filter((b) => !b.consumed);
        const totalValue = active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
        return {
          id: d.id,
          producer: d.producer,
          name: d.name,
          vintage: d.vintage,
          type: d.wineType,
          grapes: d.grapes,
          region: d.region,
          country: d.country,
          abv: d.abv,
          drinkWindow:
            d.drinkWindowStart && d.drinkWindowEnd
              ? `${d.drinkWindowStart}–${d.drinkWindowEnd}`
              : 'unknown',
          bottleCount: active.length,
          totalMarketValue: totalValue > 0 ? `$${totalValue.toFixed(2)}` : 'not priced',
          hasAiDescription: !!d.description,
          collectionNotes: d.collectionNotes || '',
        };
      });
      wines.sort((a, b) => a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name));
      return { content: [{ type: 'text', text: JSON.stringify(wines, null, 2) }] };
    }

    if (name === 'search_wines') {
      const query = ((args?.query as string) ?? '').toLowerCase();
      const snap = await db.collection('wines').get();
      const results = snap.docs
        .map((doc) => doc.data() as WineDoc)
        .filter(
          (d) =>
            d.name?.toLowerCase().includes(query) ||
            d.producer?.toLowerCase().includes(query) ||
            d.region?.toLowerCase().includes(query) ||
            d.country?.toLowerCase().includes(query) ||
            d.grapes?.toLowerCase().includes(query) ||
            String(d.vintage).includes(query) ||
            d.wineType?.toLowerCase().includes(query)
        )
        .map((d) => {
          const active = d.bottles.filter((b) => !b.consumed);
          const totalValue = active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
          return {
            id: d.id,
            producer: d.producer,
            name: d.name,
            vintage: d.vintage,
            type: d.wineType,
            grapes: d.grapes,
            region: d.region,
            drinkWindow:
              d.drinkWindowStart && d.drinkWindowEnd
                ? `${d.drinkWindowStart}–${d.drinkWindowEnd}`
                : 'unknown',
            bottleCount: active.length,
            totalMarketValue: totalValue > 0 ? `$${totalValue.toFixed(2)}` : 'not priced',
            collectionNotes: d.collectionNotes || '',
          };
        });
      return {
        content: [
          {
            type: 'text',
            text:
              results.length > 0
                ? JSON.stringify(results, null, 2)
                : `No wines found matching "${args?.query}".`,
          },
        ],
      };
    }

    if (name === 'get_wine_detail') {
      const id = args?.id as string;
      const doc = await db.collection('wines').doc(id).get();
      if (!doc.exists) {
        return {
          content: [
            {
              type: 'text',
              text: `Wine "${id}" not found. Use list_wines or search_wines to find the correct ID.`,
            },
          ],
        };
      }
      const d = doc.data() as WineDoc;
      const activeCt = d.bottles.filter((b) => !b.consumed).length;
      const totalValue = d.bottles
        .filter((b) => !b.consumed)
        .reduce((s, b) => s + (b.marketPrice ?? 0), 0);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...d,
                activeBottleCount: activeCt,
                totalMarketValue: totalValue > 0 ? `$${totalValue.toFixed(2)}` : 'not priced',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'get_collection_stats') {
      const snap = await db.collection('wines').get();
      let totalBottles = 0;
      let totalValue = 0;
      const byType: Record<string, number> = {};
      const byRegion: Record<string, number> = {};
      const peakNow: string[] = [];
      const year = new Date().getFullYear();

      for (const doc of snap.docs) {
        const d = doc.data() as WineDoc;
        const active = d.bottles.filter((b) => !b.consumed);
        totalBottles += active.length;
        totalValue += active.reduce((s, b) => s + (b.marketPrice ?? 0), 0);
        const type = d.wineType || 'unknown';
        byType[type] = (byType[type] || 0) + active.length;
        const region = d.region || d.country || 'unknown';
        byRegion[region] = (byRegion[region] || 0) + active.length;
        if (
          d.drinkWindowStart &&
          d.drinkWindowEnd &&
          year >= d.drinkWindowStart &&
          year <= d.drinkWindowEnd &&
          active.length > 0
        ) {
          peakNow.push(`${d.name} ${d.vintage} (${active.length} btl)`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalLabels: snap.size,
                totalBottles,
                totalMarketValue: `$${totalValue.toFixed(2)}`,
                byType,
                topRegions: Object.entries(byRegion)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([r, n]) => `${r}: ${n} bottles`),
                winesInPeakWindow: peakNow,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === 'mark_bottle_consumed') {
      const wineId = args?.wine_id as string;
      const bottleId = args?.bottle_id as string;
      const ref = db.collection('wines').doc(wineId);
      const doc = await ref.get();
      if (!doc.exists) {
        return { content: [{ type: 'text', text: `Wine "${wineId}" not found.` }] };
      }
      const wine = doc.data() as WineDoc;
      const bottle = wine.bottles.find((b) => b.id === bottleId);
      if (!bottle) {
        return {
          content: [
            {
              type: 'text',
              text: `Bottle "${bottleId}" not found. Available IDs: ${wine.bottles.map((b) => b.id).join(', ')}`,
            },
          ],
        };
      }
      if (bottle.consumed) {
        return {
          content: [{ type: 'text', text: `Bottle "${bottleId}" is already consumed.` }],
        };
      }
      await ref.update({
        bottles: wine.bottles.map((b) => (b.id === bottleId ? { ...b, consumed: true } : b)),
      });
      const remaining = wine.bottles.filter((b) => !b.consumed && b.id !== bottleId).length;
      return {
        content: [
          {
            type: 'text',
            text: `Marked bottle "${bottleId}" of "${wine.name}" ${wine.vintage} as consumed. ${remaining} bottles remaining.`,
          },
        ],
      };
    }

    if (name === 'update_bottle_price') {
      const wineId = args?.wine_id as string;
      const bottleId = args?.bottle_id as string;
      const price = args?.price as number;
      const currency = (args?.currency as string) || 'USD';
      const ref = db.collection('wines').doc(wineId);
      const doc = await ref.get();
      if (!doc.exists) {
        return { content: [{ type: 'text', text: `Wine "${wineId}" not found.` }] };
      }
      const wine = doc.data() as WineDoc;
      const bottle = wine.bottles.find((b) => b.id === bottleId);
      if (!bottle) {
        return {
          content: [
            {
              type: 'text',
              text: `Bottle "${bottleId}" not found. Available IDs: ${wine.bottles.map((b) => b.id).join(', ')}`,
            },
          ],
        };
      }
      await ref.update({
        bottles: wine.bottles.map((b) =>
          b.id === bottleId ? { ...b, purchasePrice: price, currency } : b
        ),
      });
      return {
        content: [
          {
            type: 'text',
            text: `Updated bottle "${bottleId}" of "${wine.name}" ${wine.vintage}: price set to ${currency} ${price.toFixed(2)}.`,
          },
        ],
      };
    }

    if (name === 'add_wine_notes') {
      const wineId = args?.wine_id as string;
      const notes = args?.notes as string;
      const ref = db.collection('wines').doc(wineId);
      const doc = await ref.get();
      if (!doc.exists) {
        return { content: [{ type: 'text', text: `Wine "${wineId}" not found.` }] };
      }
      const wine = doc.data() as WineDoc;
      await ref.update({ collectionNotes: notes });
      return {
        content: [
          {
            type: 'text',
            text: `Notes updated for "${wine.name}" ${wine.vintage}.`,
          },
        ],
      };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  });

  return server;
}
