# Freshdesk MCP Chat — Handoff Document
**Date:** 2026-04-29

---

## What This Project Is

A Windows-packaged chat application for Freshdesk support agents. A local LLM (qwen2.5:3b via Ollama) fetches Freshdesk data through a custom MCP server and drafts responses for agents to review and send manually in Freshdesk.

**Full design spec:** `docs/superpowers/specs/2026-04-29-freshdesk-mcp-chat-design.md`  
**Full implementation plan:** `docs/superpowers/plans/2026-04-29-freshdesk-mcp-chat.md`

---

## Current State

**Git repo:** `/Users/prasha-3336/freshdesk-mcp/`  
**Branch:** `master`  
**Last commit:** `d9f274e`

### Completed Tasks ✅

| Task | What Was Built | Commit |
|------|---------------|--------|
| 1 | Project scaffold (dirs, package.json, .gitignore, npm install) | `9a7148d` |
| 2 | `freshdesk-oas.yaml` — 9 read-only Freshdesk endpoints | `8623239` |
| 3 | `mcp-server/tools.js` + 12 unit tests (all passing) | `be3525a` |
| 4 | `mcp-server/index.js` — MCP stdio server with 10 tools | `d9f274e` |

### Remaining Tasks ⏳

| Task | What To Build | File |
|------|--------------|------|
| 5 | Chat app backend (Express + MCP client + Ollama agentic loop) | `chat-app/server.js` |
| 6 | Chat UI (model selector, message thread, tool pills, copy-draft button) | `chat-app/public/index.html` |
| 7 | Windows batch files | `setup.bat`, `start.bat` |
| 8 | End-to-end smoke test + zip packaging | manual |

---

## Project Structure

```
freshdesk-mcp/
├── .env.example            ← copy to .env, fill in credentials
├── .env                    ← NOT committed (gitignored) — needs real values
├── freshdesk-oas.yaml      ← OAS source of truth (edit to add new Freshdesk APIs)
├── mcp-server/
│   ├── package.json
│   ├── index.js            ← MCP stdio server entry point ✅
│   ├── tools.js            ← Pure logic: OAS parsing, URL building, API calls ✅
│   └── test/
│       └── tools.test.js   ← 12 unit tests (node:test) ✅
└── chat-app/
    ├── package.json
    ├── server.js           ← NOT YET CREATED
    └── public/
        └── index.html      ← NOT YET CREATED
```

---

## How to Resume Building

### Prerequisites
- Node.js 18+ installed
- Ollama installed with `qwen2.5:3b` pulled
- `.env` file at `freshdesk-mcp/.env` (copy from `.env.example`, fill in real values)

### Resume command
Open this conversation and continue from where we left off. The subagent-driven-development process was running. Next task to dispatch: **Task 5** (chat-app/server.js).

### Quick verification that existing code still works
```bash
cd freshdesk-mcp/mcp-server
npm test
# Expected: 12 tests pass, 0 fail

echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node index.js 2>/dev/null
# Expected: JSON with 10 tools
```

---

## Task 5 — What Needs to Be Built Next

**File:** `freshdesk-mcp/chat-app/server.js`

```javascript
// Express server (port 3000) that:
// 1. Spawns mcp-server/index.js as a child process (stdio)
// 2. Connects to it as MCP client using @modelcontextprotocol/sdk Client
// 3. Lists MCP tools on startup, converts to Ollama tool format
// 4. GET /api/models  → lists Ollama models from http://localhost:11434/api/tags
// 5. GET /api/tools   → returns list of MCP tool names + descriptions
// 6. POST /api/chat   → agentic loop:
//    a. Send messages + tools to Ollama /api/chat (non-streaming)
//    b. If response has tool_calls, execute each via mcpClient.callTool()
//    c. Append tool results to history as { role: 'tool', content: result }
//    d. Loop back (max 10 rounds), return final text + toolLog to frontend
```

Full code is in the implementation plan at `docs/superpowers/plans/2026-04-29-freshdesk-mcp-chat.md` → Task 5.

---

## Task 6 — Chat UI Key Points

**File:** `freshdesk-mcp/chat-app/public/index.html`

- Single HTML file, no build step
- Dark sidebar: model dropdown + tool chip list
- Chat thread: user bubbles right, assistant bubbles left
- Tool call pills shown under each assistant message
- **"Copy draft" button** on every assistant message (key feature for agents)
- All dynamic content via DOM methods — NO innerHTML with user/external data (security requirement enforced by project hook)
- System prompt hardcoded: instructs LLM to fetch ticket → search similar → search KB → draft

Full code is in the plan → Task 6.

---

## Key Design Decisions (for context)

1. **OAS is the single source of truth** — adding a new Freshdesk API = add one YAML block to `freshdesk-oas.yaml`, restart. Zero code changes in index.js or server.js.

2. **search/tickets quoting** — Freshdesk requires `?query="status:4"` (value in double-quotes). The LLM passes `status:4`, `freshdeskFetch()` in `tools.js` wraps it: `{ ...args, query: '"${args.query}"' }`.

3. **MCP transport is stdio** — chat app spawns MCP server as child process. No TCP/HTTP between them.

4. **Local LLM: qwen2.5:3b** — ~2GB RAM, best-in-class tool use for a 3B model. Fallback: `qwen2.5:7b` if tool calling is unreliable.

5. **Read-only Freshdesk** — no write operations. Agent reviews LLM draft and sends reply manually in Freshdesk UI.

---

## Credentials Needed (on target Windows machine)

- `FRESHDESK_DOMAIN` — your subdomain (e.g. `acme` for `acme.freshdesk.com`)
- `FRESHDESK_API_KEY` — from Freshdesk → Profile Settings → API Key
- No other API keys needed (DuckDuckGo web search is free/keyless)
