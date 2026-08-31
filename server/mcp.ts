import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getDb } from './db';
import { createWineMcpServer } from './wine-mcp-server';

/**
 * Local stdio MCP entry (Claude Code / Claude Desktop on this machine).
 * Authenticates to Firestore with gcloud Application Default Credentials;
 * no passphrase is involved because nothing is exposed to the network.
 */
async function main() {
  const server = createWineMcpServer({
    db: getDb(),
    baseUrl: (process.env.PUBLIC_BASE_URL || 'https://invintory-d6yd2jjywa-uc.a.run.app').replace(/\/+$/, ''),
  });
  await server.connect(new StdioServerTransport());
  console.error('Wine inventory MCP server running on stdio');
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
