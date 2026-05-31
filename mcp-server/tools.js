import { readFileSync } from 'fs';
import { load } from 'js-yaml';

/**
 * Parse an OAS object and return MCP tool descriptors.
 * Each descriptor: { name, description, inputSchema, _meta: { method, path, pathParams, queryParams, bodyParams } }
 * Callers must strip _meta before sending to the LLM.
 */
export function buildTools(oas) {
  const tools = [];
  for (const [path, methods] of Object.entries(oas.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (method === 'parameters' || method === 'summary' || method === 'description') continue;
      if (!op.operationId) continue;

      const properties = {};
      const required = [];
      const pathParams = new Set();
      const queryParams = new Set();
      const bodyParams = new Set();

      for (const param of op.parameters || []) {
        if (param.in !== 'path' && param.in !== 'query') continue;
        properties[param.name] = {
          type: param.schema?.type || 'string',
          description: param.description || param.name,
        };
        if (param.required === true) required.push(param.name);
        if (param.in === 'path') pathParams.add(param.name);
        else queryParams.add(param.name);
      }

      const bodySchema = op.requestBody?.content?.['application/json']?.schema;
      if (bodySchema?.properties) {
        for (const [name, schema] of Object.entries(bodySchema.properties)) {
          properties[name] = {
            type: schema.type || 'string',
            description: schema.description || name,
            ...(schema.items ? { items: schema.items } : {}),
          };
          bodyParams.add(name);
        }
        for (const name of bodySchema.required || []) {
          if (!required.includes(name)) required.push(name);
        }
      }

      tools.push({
        name: op.operationId,
        description: op.summary || op.description || op.operationId,
        inputSchema: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        _meta: {
          method: method.toUpperCase(),
          path,
          pathParams: [...pathParams],
          queryParams: [...queryParams],
          bodyParams: [...bodyParams],
        },
      });
    }
  }
  return tools;
}

/**
 * If args has `mine: true`, rewrite into the API-native filter form using agentId.
 * - search_tickets: prepends `agent_id:{id}` to query (AND-joined if a query is already present).
 * - list_tickets:   sets filter='new_and_my_open' (overriding any caller-supplied filter).
 * Returns a NEW args object with `mine` removed; passes through unchanged when mine is falsy.
 * Throws if mine is requested but agentId is not configured.
 */
export function applyMineFilter(toolName, args, agentId) {
  if (!args || !args.mine) return args;
  if (!agentId) {
    throw new Error('mine: true requires FRESHDESK_AGENT_ID to be set in .env');
  }
  const { mine, ...rest } = args;
  if (toolName === 'search_tickets') {
    const existing = (rest.query || '').trim();
    const mineExpr = `agent_id:${agentId}`;
    rest.query = existing ? `${mineExpr} AND (${existing})` : mineExpr;
    return rest;
  }
  if (toolName === 'list_tickets') {
    rest.filter = 'new_and_my_open';
    return rest;
  }
  return rest;
}

/**
 * Split args into { url, body } given the operation's _meta classification.
 * - Path params: substituted into urlPath.
 * - Query params: appended as ?key=value.
 * - Body params: collected into a JSON body (only for non-GET/DELETE methods).
 * - Unknown args (not classified): treated as query for GET/DELETE, body for POST/PUT/PATCH.
 */
export function buildRequest(baseUrl, meta, args) {
  const { method, path: urlPath, pathParams = [], queryParams = [], bodyParams = [] } = meta;
  const methodHasBody = method !== 'GET' && method !== 'DELETE';

  let path = urlPath;
  const query = new URLSearchParams();
  const body = {};

  for (const [key, value] of Object.entries(args || {})) {
    if (value === undefined) continue;
    if (pathParams.includes(key) || path.includes(`{${key}}`)) {
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    } else if (bodyParams.includes(key) && methodHasBody) {
      body[key] = value;
    } else if (queryParams.includes(key)) {
      query.set(key, String(value));
    } else if (methodHasBody) {
      body[key] = value;
    } else {
      query.set(key, String(value));
    }
  }

  const qs = query.toString();
  const url = `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  return { url, body: methodHasBody && Object.keys(body).length > 0 ? body : null };
}

/**
 * Substitute {param} placeholders in urlPath, append remaining args as query string.
 * Legacy helper kept for backwards compatibility with tests / callers that don't
 * have an operation _meta yet.
 */
export function buildUrl(baseUrl, urlPath, args) {
  let path = urlPath;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(args || {})) {
    const placeholder = `{${key}}`;
    if (path.includes(placeholder)) {
      path = path.replace(placeholder, encodeURIComponent(String(value)));
    } else {
      query.set(key, String(value));
    }
  }

  const qs = query.toString();
  return `${baseUrl}${path}${qs ? '?' + qs : ''}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make a Freshdesk API call.
 * baseUrl: https://{domain}.freshdesk.com/api/v2
 * auth: "Basic <base64>" header value
 * meta: { method, path, pathParams, queryParams, bodyParams }
 *
 * Retries on 429 (rate limit) and 5xx (transient server errors). Honors the
 * Retry-After header when present, otherwise falls back to exponential backoff.
 */
export async function freshdeskFetch(baseUrl, auth, meta, args, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;

  const processedArgs = (meta.path === '/search/tickets' && args?.query !== undefined)
    ? { ...args, query: `"${args.query}"` }
    : args;

  const { url, body } = buildRequest(baseUrl, meta, processedArgs);
  const init = {
    method: meta.method,
    headers: { Authorization: auth },
  };
  if (body) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 8000); // exponential backoff, capped at 8s
      await sleep(delayMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Freshdesk ${res.status} ${meta.method} ${meta.path}: ${text}`);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }
}

/**
 * Search the web using DuckDuckGo Instant Answer API (no API key).
 * Returns up to 6 result objects: { title?, snippet, url }
 */
export async function webSearch(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'freshdesk-mcp/1.0' } });

  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);

  const data = await res.json();
  const results = [];

  if (data.AbstractText) {
    results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
  }
  for (const r of (data.RelatedTopics || []).slice(0, 5)) {
    if (r.Text) results.push({ snippet: r.Text, url: r.FirstURL || '' });
  }

  return results.length > 0 ? results : [{ snippet: 'No results found.', url: '' }];
}

/** Load and parse a YAML file. */
export function loadOAS(oasPath) {
  return load(readFileSync(oasPath, 'utf8'));
}
