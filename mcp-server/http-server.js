#!/usr/bin/env node
import http from 'http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createFreshdeskServer } from './create-server.js';

const PORT  = Number(process.env.MCP_HTTP_PORT) || 3001;
const TOKEN = process.env.MCP_HTTP_TOKEN || '';

const httpServer = http.createServer(async (req, res) => {
  // Only accept POST /mcp
  if (req.method !== 'POST' || req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Send POST /mcp');
    return;
  }

  // Optional bearer token auth
  if (TOKEN) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
  }

  // Parse JSON body
  let body = '';
  for await (const chunk of req) body += chunk;
  let parsedBody;
  try { parsedBody = JSON.parse(body); }
  catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid JSON');
    return;
  }

  // Create a fresh server + transport per request (stateless)
  let server;
  try {
    ({ server } = createFreshdeskServer());
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Config error: ${e.message}`);
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => server.close().catch(() => {}));
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
});

httpServer.listen(PORT, () => {
  process.stderr.write(`freshdesk-mcp HTTP ready on port ${PORT}\n`);
  process.stderr.write(`Endpoint: http://localhost:${PORT}/mcp\n`);
  if (TOKEN) process.stderr.write(`Auth: Bearer token required\n`);
  else process.stderr.write(`Auth: none (add MCP_HTTP_TOKEN=secret to .env to enable)\n`);
});
