import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';
import { buildTools, freshdeskFetch, loadOAS, webSearch } from './tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = join(__dirname, '..', '.env');

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description: 'Search the web for technical info, error messages, or solutions to help resolve a support ticket',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search query' } },
    required: ['query'],
  },
  _meta: null,
};

export function createFreshdeskServer() {
  dotenv.config({ path: ENV_PATH, override: true });

  const { FRESHDESK_DOMAIN, FRESHDESK_API_KEY, FRESHDESK_AGENT_ID } = process.env;
  if (!FRESHDESK_DOMAIN || !FRESHDESK_API_KEY) {
    throw new Error('Missing FRESHDESK_DOMAIN or FRESHDESK_API_KEY in .env');
  }

  const BASE_URL = `https://${FRESHDESK_DOMAIN}.freshdesk.com/api/v2`;
  const AUTH     = `Basic ${Buffer.from(`${FRESHDESK_API_KEY}:X`).toString('base64')}`;

  const oas      = loadOAS(join(__dirname, '..', 'freshdesk-oas.yaml'));
  const allTools = [...buildTools(oas), WEB_SEARCH_TOOL];
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

  return { server, publicTools };
}
