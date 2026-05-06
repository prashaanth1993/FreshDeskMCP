#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFreshdeskServer } from './create-server.js';

const { server, publicTools } = createFreshdeskServer();
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`freshdesk-mcp ready: ${publicTools.length} tools\n`);
