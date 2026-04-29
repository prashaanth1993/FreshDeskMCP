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
**Last commit:** `23f8ae3`

### Completed Tasks ✅

| Task | What Was Built | Commit |
|------|---------------|--------|
| 1 | Project scaffold (dirs, package.json, .gitignore, npm install) | `9a7148d` |
| 2 | `freshdesk-oas.yaml` — 9 read-only Freshdesk endpoints | `8623239` |
| 3 | `mcp-server/tools.js` + 12 unit tests (all passing) | `be3525a` |
| 4 | `mcp-server/index.js` — MCP stdio server with 10 tools | `d9f274e` |
| 5 | `chat-app/server.js` — Express + MCP client + Ollama agentic loop | (Task 5 commit) |
| 6 | `chat-app/public/index.html` — Single-file chat UI | (Task 6 commit) |
| 7 | `setup.bat` + `start.bat` — Windows batch files (fixed `/dev/null` → `nul`) | `23f8ae3` |

### Remaining Tasks ⏳

| Task | What To Build |
|------|--------------|
| 8 | End-to-end smoke test (requires real Freshdesk creds + Ollama) + zip packaging |

---

## Project Structure

```
freshdesk-mcp/
├── .env.example            ← copy to .env, fill in credentials
├── .env                    ← NOT committed (gitignored) — needs real values
├── freshdesk-oas.yaml      ← OAS source of truth (edit to add new Freshdesk APIs)
├── setup.bat               ← Windows one-time setup ✅
├── start.bat               ← Windows daily start ✅
├── mcp-server/
│   ├── package.json
│   ├── index.js            ← MCP stdio server entry point ✅
│   ├── tools.js            ← Pure logic: OAS parsing, URL building, API calls ✅
│   └── test/
│       └── tools.test.js   ← 12 unit tests (node:test) ✅
└── chat-app/
    ├── package.json
    ├── server.js           ← Express + agentic loop ✅
    └── public/
        └── index.html      ← Single-file chat UI ✅
```

---

## How to Test

### Quick verification that existing code still works
```bash
cd freshdesk-mcp/mcp-server
npm test
# Expected: 12 tests pass, 0 fail

echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node index.js 2>/dev/null
# Expected: JSON with 10 tools
```

### Full end-to-end test (needs real credentials)
1. Copy `.env.example` → `.env`, fill in `FRESHDESK_DOMAIN` and `FRESHDESK_API_KEY`
2. Install Ollama + pull `qwen2.5:3b`
3. Run `node chat-app/server.js`
4. Open `http://localhost:3000`
5. Send: "Show me ticket 1" — LLM should call `get_ticket` and return formatted result

---

## Task 8 — What's Left

1. **Smoke test** with real Freshdesk credentials and Ollama running
2. **Package as zip**: `freshdesk-mcp.zip` excluding `node_modules/`, `.env`, `.git/`
   ```bash
   zip -r freshdesk-mcp.zip freshdesk-mcp/ \
     --exclude "*/node_modules/*" \
     --exclude "*/.env" \
     --exclude "*/.git/*"
   ```
3. Verify `setup.bat` and `start.bat` work correctly on a Windows machine

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
