# FreshDesk MCP

A comprehensive [Model Context Protocol](https://modelcontextprotocol.io/) server for Freshdesk, plus an optional local-LLM chatbot UI powered by [Ollama](https://ollama.com/).

The MCP server exposes the Freshdesk REST v2 API as a set of typed tools that any MCP-compatible client (Claude Code, Claude Desktop, custom agents, etc.) can call. Tools are generated from a single OpenAPI spec, so adding a new endpoint is one YAML edit away.

## What's in here

- **`mcp-server/`** — the MCP server itself. Stateless, read+write coverage of Freshdesk v2 (78 tools across tickets, contacts, companies, agents, groups, knowledge base, time entries, conversations, surveys, and admin reads).
- **`chat-app/`** — an optional local web UI that talks to an Ollama model and gives it the MCP tools. Lets you chat with your Freshdesk in plain English without sending data to a hosted LLM provider.
- **`wizard.html`** — a setup wizard served by the chat app that walks new users through `.env` configuration.
- **`freshdesk-oas.yaml`** — the OpenAPI spec the MCP tools are generated from. Single source of truth for what the server can do.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/prashaanth1993/FreshDeskMCP.git
cd FreshDeskMCP
./setup.sh        # macOS/Linux
# or
setup.bat         # Windows
```

This installs dependencies under `mcp-server/` and `chat-app/`.

### 2. Configure your credentials

> [!IMPORTANT]
> **Never commit credentials.** `.env` and `.mcp.json` are gitignored. Each developer must create their own copies locally. Do not paste API keys into pull requests, issues, screenshots, or anywhere else public.

Copy the examples and fill them in:

```bash
cp .env.example .env
cp .mcp.json.example .mcp.json
```

Edit `.env`:

```ini
FRESHDESK_DOMAIN=yoursubdomain         # the part before .freshdesk.com
FRESHDESK_API_KEY=your_api_key_here    # Profile Settings → View API Key in Freshdesk
FRESHDESK_AGENT_ID=                    # optional — enables the `mine: true` shortcut
OLLAMA_URL=http://localhost:11434      # only needed for the chat-app
```

Edit `.mcp.json` (the MCP client config — used by Claude Code, Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "freshdesk": {
      "command": "node",
      "args": ["mcp-server/index.js"],
      "env": {
        "FRESHDESK_DOMAIN": "yoursubdomain",
        "FRESHDESK_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

The MCP server reads `.env` at startup with `dotenv override`, so the values in `.env` win even if `.mcp.json` sets the same variables.

#### Finding your Agent ID (optional)

Setting `FRESHDESK_AGENT_ID` unlocks the `mine: true` shortcut on `list_tickets` and `search_tickets` — auto-filters results to tickets assigned to you without restating the ID. To find it:

1. In Freshdesk → **Admin → Agents**, click your own profile.
2. Copy the numeric ID from the URL (e.g. `https://yoursub.freshdesk.com/a/admin/agents/50000123456`).

### 3. Run

```bash
./start.sh        # macOS/Linux — starts the chat-app on http://localhost:3000
# or
start.bat         # Windows
```

Or, to use the MCP server directly from an MCP client (Claude Code etc.), just point your client config at this repo's `.mcp.json` — there is no separate "start" step for the server itself; the client spawns it on demand.

## Using with Claude Code

Once `.mcp.json` is in place and you've launched Claude Code from this directory, the `freshdesk` server appears in `/mcp` automatically. Try:

> "Find my open tickets" → calls `search_tickets({ mine: true, query: "status:2" })`
>
> "Show me ticket 12345 with the full conversation thread" → calls `get_ticket({ ticket_id: 12345, include: "conversations" })`
>
> "Reply to ticket 12345 saying I've escalated to engineering" → calls `reply_to_ticket(...)`

## Tool catalogue (78 tools)

Generated from `freshdesk-oas.yaml`. Highlights:

| Domain | Reads | Writes |
|--------|-------|--------|
| Tickets | `list_tickets`, `get_ticket`, `search_tickets`, `list_ticket_conversations`, `list_ticket_time_entries`, `get_ticket_satisfaction_ratings` | `create_ticket`, `update_ticket`, `delete_ticket`, `restore_ticket`, `reply_to_ticket`, `add_note_to_ticket`, `merge_tickets`, `create_ticket_time_entry` |
| Contacts | `list_contacts`, `get_contact`, `search_contacts` | `create_contact`, `update_contact`, `delete_contact`, `restore_contact`, `hard_delete_contact`, `merge_contacts` |
| Companies | `list_companies`, `get_company`, `search_companies`, `autocomplete_companies` | `create_company`, `update_company`, `delete_company` |
| Agents | `list_agents`, `get_agent`, `get_current_agent`, `search_agents` | `create_agent`, `update_agent`, `delete_agent` |
| Groups | `list_groups`, `get_group` | `create_group`, `update_group`, `delete_group` |
| Knowledge Base | `list_kb_categories`, `get_kb_category`, `list_kb_folders`, `get_kb_folder`, `get_kb_articles`, `get_kb_article`, `search_kb` | `create/update/delete` for categories, folders, articles |
| Conversations | — | `update_conversation`, `delete_conversation` |
| Time Entries | `list_time_entries` | `update_time_entry`, `delete_time_entry` |
| Admin reads | `list_roles`, `get_role`, `list_skills`, `get_skill`, `list_email_configs`, `get_email_config`, `list_products`, `get_product`, `list_business_hours`, `get_business_hours`, `list_sla_policies`, `list_ticket_fields`, `list_contact_fields`, `list_company_fields` | — |
| Surveys | `list_satisfaction_ratings` | — |
| Extras | `web_search` (DuckDuckGo for ticket research) | — |

### The `mine: true` shortcut

When `FRESHDESK_AGENT_ID` is set, `list_tickets` and `search_tickets` accept an extra `mine: true` parameter:

- `search_tickets({ mine: true })` → searches with `agent_id:<your_id>`
- `search_tickets({ mine: true, query: "status:2" })` → `agent_id:<your_id> AND (status:2)`
- `list_tickets({ mine: true })` → applies the `new_and_my_open` preset filter

The agent ID is read from `.env` at server startup and never sent in the tool schema's literal values to anything external.

## Local-LLM chatbot (chat-app)

Optional. Lets you chat with Freshdesk through a local Ollama model so no ticket data leaves your machine.

```bash
# 1. Install Ollama and pull a tool-calling model (qwen2.5 works well)
ollama pull qwen2.5:7b

# 2. Start it (usually auto-runs on macOS)
ollama serve

# 3. Start the chat app
cd chat-app && npm start
# open http://localhost:3000
```

The chat-app spawns the MCP server as a subprocess via stdio, lists its tools, and offers them to the Ollama model on each turn. Tool calls go through the same Freshdesk API as the MCP server itself, so the LLM has full read/write access subject to your API key's permissions.

## Adding a new Freshdesk endpoint

Three lines of edit, no code:

1. Open `freshdesk-oas.yaml`.
2. Find the right section (or create a new one) and add a path entry with `operationId`, `summary`, parameters, and (for writes) a `requestBody` schema.
3. Restart the MCP server. The new tool appears automatically.

The generator (`mcp-server/tools.js → buildTools`) handles path params, query params, JSON request bodies, and required-field detection.

## Architecture

```
                ┌──────────────────────────┐
                │   MCP client             │
                │ (Claude Code, Desktop,   │
                │  custom agent, chat-app) │
                └─────────────┬────────────┘
                              │ JSON-RPC over stdio
                              ▼
                ┌──────────────────────────┐
                │ mcp-server/index.js      │
                │   create-server.js       │  ← injects `mine` param if AGENT_ID set
                │   tools.js               │  ← buildTools / freshdeskFetch
                └─────────────┬────────────┘
                              │ HTTPS
                              ▼
                ┌──────────────────────────┐
                │ Freshdesk REST v2 API    │
                └──────────────────────────┘
```

The server is stateless. Each tool call is a single Freshdesk HTTP request.

## Development

```bash
cd mcp-server
npm install
npm test          # 28 unit tests on buildTools / buildRequest / applyMineFilter
```

Tests are pure — they don't touch the network or `.env`. Add a new test in `mcp-server/test/tools.test.js`.

## Security notes

- `.env` and `.mcp.json` are gitignored. **Never** commit them.
- Freshdesk API keys grant whatever permissions your agent account has, including DELETE. With `Full CRUD` coverage, the LLM can theoretically delete tickets/contacts/companies/articles. Use an API key from an account with appropriate scope; for read-only experimentation, create a restricted agent role.
- The server uses HTTP Basic auth (`API_KEY:X`) per Freshdesk's documented scheme.
- The `web_search` tool hits the DuckDuckGo Instant Answer API directly — no key, no auth, no rate-limit handling. Treat results as untrusted input.

## License

MIT — see `LICENSE`.

## Contributing

PRs welcome. For new Freshdesk endpoints, add them to `freshdesk-oas.yaml` and the tools will be generated automatically. For server-behavior changes (auth, transport, response shaping), edit `mcp-server/tools.js` and add tests.
