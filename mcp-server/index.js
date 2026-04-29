#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';
import { buildTools, freshdeskFetch, loadOAS, webSearch } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const { FRESHDESK_DOMAIN, FRESHDESK_API_KEY } = process.env;
if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
  process.stderr.write('ERROR: Missing FRESHDESK_DOMAIN or FRESHDESK_API_KEY in .env\n');
  process.exit(1);
}

const BASE_URL = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2`;
const AUTH = `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`;

const oas = loadOAS(join(__dirname, '..', 'freshdesk-oas.yaml'));
const oasTools = buildTools(oas);

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: 'Search the web for technical info, error messages, or solutions to help resolve a support ticket',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query, e.g. "how to reset 2FA on Google"' },
    },
    required: ['query'],
  },
  _meta: null,
};

const allTools = [...oasTools, WEB_SEARCH_TOOL];
const publicTools = allTools.map(({ _meta, ...t }) => t);

const server = new Server(
  { name: 'freshdesk-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: publicTools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let result;
    if (name === 'web_search') {
      result = await webSearch(args.query);
    } else {
      const tool = allTools.find(t => t.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      result = await freshdeskFetch(BASE_URL, AUTH, tool._meta.method, tool._meta.path, args);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`freshdesk-mcp ready: ${publicTools.length} tools\n`);
