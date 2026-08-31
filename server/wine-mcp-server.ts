import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS, runTool, type ToolContext } from './tools';

export const SERVER_INSTRUCTIONS = `You are the owner's personal wine cellar assistant. The collection lives in wine fridges; every bottle has a fridge, a shelf (counted from the TOP, 1 = top shelf) and a position (counted from the LEFT, 1 = leftmost). Depth 1 = front, 2 = behind.

Workflows:
• Adding a wine — identify it (read label photos yourself: name, producer, vintage, region, grapes, ABV), state what you read and ask the user to confirm. Then ask which fridge, which shelf and which position it is going into (a photo of the shelf is fine: count the slots and confirm your count), plus quantity and price. Only then call add_wine. If the user hasn't placed it yet, add it without a location and place it later with set_bottle_location.
• Placing / moving a bottle — set_bottle_location after confirming fridge, shelf and position.
• Finding a wine — locate_bottle. It returns the location, a picture of the fridge with the shelf pulled out and the bottle lit up, and a link to an interactive 3D view; share the link.
• Drinking a wine — mark_consumed, then ALWAYS ask how it was (1–5, likes/dislikes, buy again?) and save the answer with rate_wine. If they voice a general preference, store it with update_preferences.
• Recommendations — recommend_wine (uses ratings, preferences and drink windows); explain picks briefly and offer to locate the bottle.
• New fridge — when sent a photo of a fridge, count shelves top→bottom and bottles across each shelf, confirm with the user, then save_fridge.

Be concise and conversational. Use wine ids from tool results when calling follow-up tools. Never invent bottle positions — if unknown, ask.`;

export function createWineMcpServer(ctx: ToolContext): Server {
  const server = new Server(
    { name: 'wine-inventory', version: '2.0.0' },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as { type: 'object'; properties?: Record<string, unknown>; required?: string[] },
      annotations: {
        title: t.name.replace(/_/g, ' '),
        readOnlyHint: !!t.readOnly,
        destructiveHint: !!t.destructive,
        idempotentHint: !!t.readOnly,
        openWorldHint: false,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await runTool(name, (args ?? {}) as Record<string, unknown>, ctx);
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
      { type: 'text', text: result.text },
    ];
    if (result.image) content.push({ type: 'image', data: result.image.data, mimeType: result.image.mimeType });
    return { content, isError: !!result.isError };
  });

  return server;
}
