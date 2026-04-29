import { readFileSync } from 'fs';
import { load } from 'js-yaml';

/**
 * Parse an OAS object and return MCP tool descriptors.
 * Each descriptor: { name, description, inputSchema, _meta: { method, path } }
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

      for (const param of op.parameters || []) {
        if (param.in !== 'path' && param.in !== 'query') continue;
        properties[param.name] = {
          type: param.schema?.type || 'string',
          description: param.description || param.name,
        };
        if (param.required === true) required.push(param.name);
      }

      tools.push({
        name: op.operationId,
        description: op.summary || op.description || op.operationId,
        inputSchema: {
          type: 'object',
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        _meta: { method: method.toUpperCase(), path },
      });
    }
  }
  return tools;
}

/**
 * Substitute {param} placeholders in urlPath, append remaining args as query string.
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

/**
 * Make a read-only Freshdesk API call.
 * baseUrl: https://{domain}.freshdesk.com/api/v2
 * auth: "Basic <base64>" header value
 */
export async function freshdeskFetch(baseUrl, auth, method, path, args) {
  // Freshdesk search/tickets requires query value wrapped in double-quotes
  const processedArgs = (path === '/search/tickets' && args?.query !== undefined)
    ? { ...args, query: `"${args.query}"` }
    : args;

  const url = buildUrl(baseUrl, path, processedArgs);
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Freshdesk ${res.status} ${method} ${path}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
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
