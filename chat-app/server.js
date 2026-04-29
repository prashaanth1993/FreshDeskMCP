import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MCP_SERVER = join(__dirname, '..', 'mcp-server', 'index.js');
const PORT = Number(process.env.PORT) || 3000;

let mcpClient;
let mcpTools = [];

async function initMCP() {
  const transport = new StdioClientTransport({ command: 'node', args: [MCP_SERVER] });
  mcpClient = new Client({ name: 'chat-app', version: '1.0.0' }, { capabilities: {} });
  await mcpClient.connect(transport);

  const { tools } = await mcpClient.listTools();
  mcpTools = tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  console.log(`MCP connected — ${mcpTools.length} tools available`);
}

async function callMCPTool(name, args) {
  const result = await mcpClient.callTool({ name, arguments: args });
  return result.content[0]?.text || '';
}

const app = express();
app.use((_, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/api/models', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!r.ok) throw new Error(`Ollama ${r.status}`);
    const d = await r.json();
    res.json(d.models || []);
  } catch (e) {
    res.status(503).json({ error: `Ollama unreachable: ${e.message}` });
  }
});

app.get('/api/tools', (_req, res) => {
  res.json(mcpTools.map(t => ({ name: t.function.name, description: t.function.description })));
});

app.post('/api/chat', async (req, res) => {
  const { messages, model } = req.body;
  if (!Array.isArray(messages) || messages.length === 0 || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'messages must be a non-empty array and model must be a non-empty string' });
  }

  const history = [...messages];
  const toolLog = [];

  try {
    for (let round = 0; round < 10; round++) {
      const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: history, tools: mcpTools, stream: false }),
      });

      if (!ollamaRes.ok) {
        const text = await ollamaRes.text();
        throw new Error(`Ollama ${ollamaRes.status}: ${text}`);
      }

      const data = await ollamaRes.json();
      const msg = data.message;
      if (!msg) throw new Error(`Unexpected Ollama response: ${JSON.stringify(data)}`);
      history.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return res.json({ message: msg.content, tool_calls: toolLog });
      }

      for (const tc of msg.tool_calls) {
        const { name, arguments: args } = tc.function;
        let result;
        try { result = await callMCPTool(name, args); }
        catch (e) { result = `Tool error: ${e.message}`; }
        toolLog.push({ name, args, result });
        history.push({ role: 'tool', content: result });
      }
    }

    return res.json({ message: 'Reached max tool rounds.', tool_calls: toolLog });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

initMCP().then(() => {
  app.listen(PORT, () => console.log(`Freshdesk AI ready at http://localhost:${PORT}`));
}).catch(e => { console.error('MCP init failed:', e.message); process.exit(1); });
