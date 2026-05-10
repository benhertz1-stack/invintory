import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import admin from 'firebase-admin';
import { createWineMcpServer } from './wine-mcp-server';

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'invintory-495823' });
const db = admin.firestore();

async function main() {
  const server = createWineMcpServer(db);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Wine inventory MCP server running on stdio');
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
