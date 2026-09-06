import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import * as dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const OLLAMA_URL  = process.env.OLLAMA_URL || 'http://localhost:11434';
const MCP_SERVER  = join(__dirname, '..', 'mcp-server', 'index.js');
const PORT        = Number(process.env.PORT) || 3000;
const LOG_FILE    = join(__dirname, '..', 'logs', 'app.log');
const OLLAMA_TIMEOUT_MS = 120_000; // 2 minutes

// ── Logging ──────────────────────────────────────────────────────────────────

mkdirSync(join(__dirname, '..', 'logs'), { recursive: true });

function log(level, ...parts) {
  const line = `[${new Date().toISOString()}] [${level}] ${parts.join(' ')}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch { /* non-fatal */ }
}

// ── MCP ───────────────────────────────────────────────────────────────────────

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
  log('INFO', `MCP connected — ${mcpTools.length} tools available`);
}

async function reinitMCP() {
  try { await mcpClient?.close(); } catch { /* ignore */ }
  mcpClient = null;
  mcpTools  = [];
  await initMCP();
}

async function callMCPTool(name, args) {
  const result = await mcpClient.callTool({ name, arguments: args });
  return { text: result.content[0]?.text || '', isError: Boolean(result.isError) };
}

// ── Ollama fetch with timeout and clear error ─────────────────────────────────

async function ollamaFetch(path, body) {
  const url = `${OLLAMA_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new Error(`Ollama timed out after ${OLLAMA_TIMEOUT_MS / 1000}s — model may be overloaded`);
    if (e.cause?.code === 'ECONNREFUSED') throw new Error('Ollama is not running — start it with: ollama serve');
    throw new Error(`Ollama unreachable (${e.message})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use((_, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next(); });
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/api/models', async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Ollama ${r.status}`);
    const d = await r.json();
    res.json(d.models || []);
  } catch (e) {
    res.status(503).json({ error: `Ollama unreachable: ${e.message}` });
  }
});

app.get('/api/version', (_req, res) => {
  try {
    const v = readFileSync(join(__dirname, '..', 'VERSION'), 'utf8').trim();
    res.json({ version: v });
  } catch { res.json({ version: 'unknown' }); }
});

app.get('/api/env-status', (_req, res) => {
  const domain   = process.env.FRESHDESK_DOMAIN   || '';
  const key      = process.env.FRESHDESK_API_KEY   || '';
  const agentId  = process.env.FRESHDESK_AGENT_ID  || '';
  res.json({
    domain,
    keyPreview: key ? key.slice(0, 4) + '•'.repeat(Math.max(0, key.length - 4)) : '',
    agentId,
    missing: !domain || !key,
  });
});

app.post('/api/env', async (req, res) => {
  const { domain, apiKey, agentId } = req.body || {};
  if (!domain || !apiKey) return res.status(400).json({ error: 'domain and apiKey are required' });

  const envPath = join(__dirname, '..', '.env');
  try {
    const agentLine = agentId ? `\nFRESHDESK_AGENT_ID=${agentId}` : '';
    writeFileSync(envPath, `FRESHDESK_DOMAIN=${domain}\nFRESHDESK_API_KEY=${apiKey}${agentLine}\n`);
  } catch (e) {
    return res.status(500).json({ error: `Could not write .env: ${e.message}` });
  }

  process.env.FRESHDESK_DOMAIN  = domain;
  process.env.FRESHDESK_API_KEY = apiKey;
  if (agentId) process.env.FRESHDESK_AGENT_ID = agentId;

  try {
    await reinitMCP();
    log('INFO', `Config updated: domain=${domain}`);
    res.json({ ok: true, tools: mcpTools.length });
  } catch (e) {
    log('ERROR', `MCP reinit failed: ${e.message}`);
    res.status(500).json({ error: `Saved .env but MCP reinit failed: ${e.message}` });
  }
});

app.get('/api/tools', (_req, res) => {
  res.json(mcpTools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters,
  })));
});

app.post('/api/tools/call', async (req, res) => {
  const { name, arguments: args = {} } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name must be a non-empty string' });
  }
  if (!mcpTools.some(t => t.function.name === name)) {
    return res.status(404).json({ error: `Unknown tool: ${name}` });
  }

  log('INFO', `manual tool call  name=${name} args=${JSON.stringify(args)}`);
  try {
    const { text, isError } = await callMCPTool(name, args);
    res.json({ result: text, isError });
  } catch (e) {
    log('WARN', `manual tool call failed  name=${name} error=${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages, model } = req.body;
  if (!Array.isArray(messages) || messages.length === 0 || typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'messages must be a non-empty array and model must be a non-empty string' });
  }

  const reqId   = Math.random().toString(36).slice(2, 7);
  const started = Date.now();
  const lastMsg = messages.at(-1);
  log('INFO', `[${reqId}] chat start  model=${model} turns=${messages.length} msg="${String(lastMsg?.content || '').slice(0, 80)}"`);

  const history = [...messages];
  const toolLog = [];
  const MAX_CONSECUTIVE_FAILURES = 2;
  let consecutiveFailures = 0;
  let lastError = '';

  try {
    for (let round = 0; round < 10; round++) {
      const t0  = Date.now();
      log('INFO', `[${reqId}] ollama round=${round + 1}`);

      const data = await ollamaFetch('/api/chat', { model, messages: history, tools: mcpTools, stream: false });
      const msg  = data.message;
      if (!msg) throw new Error(`Unexpected Ollama response: ${JSON.stringify(data)}`);

      log('INFO', `[${reqId}] ollama done  round=${round + 1} ms=${Date.now() - t0} tool_calls=${msg.tool_calls?.length ?? 0}`);
      history.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        log('INFO', `[${reqId}] chat done  total_ms=${Date.now() - started} rounds=${round + 1}`);
        return res.json({ message: msg.content, tool_calls: toolLog });
      }

      for (const tc of msg.tool_calls) {
        const { name, arguments: args } = tc.function;
        log('INFO', `[${reqId}] tool call  name=${name} args=${JSON.stringify(args)}`);
        const t1 = Date.now();
        let result, failed;
        try {
          const { text, isError } = await callMCPTool(name, args);
          result = text;
          failed = isError;
          log('INFO', `[${reqId}] tool ${isError ? 'err' : 'ok'}    name=${name} ms=${Date.now() - t1} result_len=${result.length}`);
        } catch (e) {
          result = `Tool error: ${e.message}`;
          failed = true;
          log('WARN', `[${reqId}] tool fail  name=${name} error=${e.message}`);
        }
        toolLog.push({ name, args, result, isError: Boolean(failed) });
        history.push({ role: 'tool', content: result });

        if (failed) {
          consecutiveFailures++;
          lastError = result;
        } else {
          consecutiveFailures = 0;
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          log('WARN', `[${reqId}] stopping after ${consecutiveFailures} consecutive tool failures`);
          return res.json({
            message: `I hit repeated tool errors and stopped rather than keep guessing. Last error: ${lastError}`,
            tool_calls: toolLog,
          });
        }
      }
    }

    log('WARN', `[${reqId}] max rounds reached`);
    return res.json({ message: 'Reached max tool rounds.', tool_calls: toolLog });

  } catch (e) {
    log('ERROR', `[${reqId}] chat error  ms=${Date.now() - started} error=${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

const MAX_PORT_ATTEMPTS = 10;

function listenWithPortFallback(startPort, attemptsLeft) {
  const server = app.listen(startPort, () => log('INFO', `Freshdesk AI ready at http://localhost:${startPort}`));
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) {
      log('WARN', `Port ${startPort} in use, trying ${startPort + 1}`);
      listenWithPortFallback(startPort + 1, attemptsLeft - 1);
    } else {
      log('ERROR', `Server failed to start: ${e.message}`);
      process.exit(1);
    }
  });
}

initMCP().then(() => {
  listenWithPortFallback(PORT, MAX_PORT_ATTEMPTS);
}).catch(e => { log('ERROR', `MCP init failed: ${e.message}`); process.exit(1); });
