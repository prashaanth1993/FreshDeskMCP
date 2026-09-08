import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { applyMineFilter, buildRequest, buildTools, buildUrl, findMissingRequired, freshdeskFetch, normalizeTicketListing, shrinkForModel, stripUnknownArgs } from '../tools.js';

// Inline minimal OAS — no file I/O or network needed
const SAMPLE_OAS = load(`
openapi: 3.0.0
info:
  title: Test
  version: 1.0.0
paths:
  /tickets:
    get:
      operationId: list_tickets
      summary: List tickets
      parameters:
        - name: filter
          in: query
          schema: { type: string }
          description: Filter preset
        - name: page
          in: query
          schema: { type: integer }
          description: Page number
    post:
      operationId: create_ticket
      summary: Create a ticket
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [subject, status]
              properties:
                subject: { type: string, description: Subject }
                status: { type: integer, description: Status code }
                tags: { type: array, items: { type: string }, description: Tags }
  /tickets/{ticket_id}:
    get:
      operationId: get_ticket
      summary: Get a ticket by ID
      parameters:
        - name: ticket_id
          in: path
          required: true
          schema: { type: integer }
          description: Ticket ID
        - name: include
          in: query
          schema: { type: string }
          description: Related data to include
    put:
      operationId: update_ticket
      summary: Update a ticket
      parameters:
        - name: ticket_id
          in: path
          required: true
          schema: { type: integer }
          description: Ticket ID
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                status: { type: integer, description: Status code }
                priority: { type: integer, description: Priority code }
    delete:
      operationId: delete_ticket
      summary: Delete a ticket
      parameters:
        - name: ticket_id
          in: path
          required: true
          schema: { type: integer }
          description: Ticket ID
`);

test('buildTools returns one tool per operationId', () => {
  const tools = buildTools(SAMPLE_OAS);
  assert.strictEqual(tools.length, 5);
});

test('buildTools maps operationId to tool name', () => {
  const tools = buildTools(SAMPLE_OAS);
  const names = tools.map(t => t.name);
  assert.ok(names.includes('list_tickets'), 'should include list_tickets');
  assert.ok(names.includes('get_ticket'), 'should include get_ticket');
});

test('buildTools uses summary as description', () => {
  const tools = buildTools(SAMPLE_OAS);
  const list = tools.find(t => t.name === 'list_tickets');
  assert.strictEqual(list.description, 'List tickets');
});

test('buildTools marks path params as required', () => {
  const tools = buildTools(SAMPLE_OAS);
  const getTkt = tools.find(t => t.name === 'get_ticket');
  assert.deepStrictEqual(getTkt.inputSchema.required, ['ticket_id']);
});

test('buildTools omits required array when no required params', () => {
  const tools = buildTools(SAMPLE_OAS);
  const list = tools.find(t => t.name === 'list_tickets');
  assert.strictEqual(list.inputSchema.required, undefined);
});

test('buildTools includes all params as inputSchema properties', () => {
  const tools = buildTools(SAMPLE_OAS);
  const getTkt = tools.find(t => t.name === 'get_ticket');
  assert.ok('ticket_id' in getTkt.inputSchema.properties);
  assert.ok('include' in getTkt.inputSchema.properties);
});

test('buildTools attaches _meta with method and path', () => {
  const tools = buildTools(SAMPLE_OAS);
  const list = tools.find(t => t.name === 'list_tickets');
  assert.strictEqual(list._meta.method, 'GET');
  assert.strictEqual(list._meta.path, '/tickets');
});

test('buildUrl substitutes path parameters', () => {
  const url = buildUrl('https://acme.freshdesk.com/api/v2', '/tickets/{ticket_id}', { ticket_id: 42 });
  assert.strictEqual(url, 'https://acme.freshdesk.com/api/v2/tickets/42');
});

test('buildUrl appends query parameters', () => {
  const url = buildUrl('https://acme.freshdesk.com/api/v2', '/tickets', { filter: 'new_and_my_open', page: 2 });
  assert.ok(url.includes('filter=new_and_my_open'), 'should include filter');
  assert.ok(url.includes('page=2'), 'should include page');
});

test('buildUrl handles mixed path and query params', () => {
  const url = buildUrl(
    'https://acme.freshdesk.com/api/v2',
    '/tickets/{ticket_id}',
    { ticket_id: 99, include: 'conversations' }
  );
  assert.ok(url.includes('/tickets/99'), 'path param substituted');
  assert.ok(url.includes('include=conversations'), 'query param appended');
  assert.ok(!url.includes('{ticket_id}'), 'placeholder removed');
});

test('buildUrl produces clean URL with empty args', () => {
  const url = buildUrl('https://acme.freshdesk.com/api/v2', '/solutions/categories', {});
  assert.strictEqual(url, 'https://acme.freshdesk.com/api/v2/solutions/categories');
});

test('buildUrl does not add quotes to search/tickets query (quoting is handled by freshdeskFetch)', () => {
  const url = buildUrl('https://acme.freshdesk.com/api/v2', '/search/tickets', { query: 'status:4' });
  const parsed = new URL(url);
  // buildUrl is generic — no special quoting here
  assert.strictEqual(parsed.searchParams.get('query'), 'status:4');
});

test('applyMineFilter passes through when mine is falsy', () => {
  const args = { query: 'status:2' };
  assert.deepStrictEqual(applyMineFilter('search_tickets', args, '123'), { query: 'status:2' });
  assert.deepStrictEqual(applyMineFilter('search_tickets', {}, '123'), {});
});

test('applyMineFilter on search_tickets sets agent_id when no query exists', () => {
  const out = applyMineFilter('search_tickets', { mine: true }, '99999');
  assert.strictEqual(out.query, 'agent_id:99999');
  assert.ok(!('mine' in out), 'mine flag stripped');
});

test('applyMineFilter on search_tickets AND-joins agent_id with existing query', () => {
  const out = applyMineFilter('search_tickets', { mine: true, query: 'status:2' }, '99999');
  assert.strictEqual(out.query, 'agent_id:99999 AND (status:2)');
});

test('applyMineFilter on list_tickets sets new_and_my_open filter', () => {
  const out = applyMineFilter('list_tickets', { mine: true }, '99999');
  assert.strictEqual(out.filter, 'new_and_my_open');
  assert.ok(!('mine' in out));
});

test('applyMineFilter on list_tickets overrides caller-supplied filter', () => {
  const out = applyMineFilter('list_tickets', { mine: true, filter: 'open' }, '99999');
  assert.strictEqual(out.filter, 'new_and_my_open');
});

test('applyMineFilter throws if mine is true but agentId is missing', () => {
  assert.throws(
    () => applyMineFilter('search_tickets', { mine: true }, undefined),
    /FRESHDESK_AGENT_ID/
  );
});

test('applyMineFilter ignores mine on unrelated tools', () => {
  const out = applyMineFilter('get_ticket', { mine: true, ticket_id: 1 }, '123');
  assert.deepStrictEqual(out, { ticket_id: 1 });
});

// ─── requestBody / write-method tests ─────────────────────────────

test('buildTools extracts requestBody properties as inputSchema fields', () => {
  const tools = buildTools(SAMPLE_OAS);
  const create = tools.find(t => t.name === 'create_ticket');
  assert.ok('subject' in create.inputSchema.properties);
  assert.ok('status' in create.inputSchema.properties);
  assert.ok('tags' in create.inputSchema.properties);
});

test('buildTools marks requestBody.required properties as required', () => {
  const tools = buildTools(SAMPLE_OAS);
  const create = tools.find(t => t.name === 'create_ticket');
  assert.ok(create.inputSchema.required.includes('subject'));
  assert.ok(create.inputSchema.required.includes('status'));
});

test('buildTools classifies params into pathParams/queryParams/bodyParams in _meta', () => {
  const tools = buildTools(SAMPLE_OAS);
  const update = tools.find(t => t.name === 'update_ticket');
  assert.deepStrictEqual(update._meta.pathParams, ['ticket_id']);
  assert.deepStrictEqual(update._meta.queryParams, []);
  assert.deepStrictEqual(update._meta.bodyParams.sort(), ['priority', 'status']);
});

test('buildTools preserves array item schema for body params', () => {
  const tools = buildTools(SAMPLE_OAS);
  const create = tools.find(t => t.name === 'create_ticket');
  assert.deepStrictEqual(create.inputSchema.properties.tags.items, { type: 'string' });
});

test('buildRequest on GET puts all args into query string', () => {
  const tools = buildTools(SAMPLE_OAS);
  const list = tools.find(t => t.name === 'list_tickets');
  const { url, body } = buildRequest('https://acme.freshdesk.com/api/v2', list._meta, { filter: 'open', page: 2 });
  assert.ok(url.includes('filter=open'));
  assert.ok(url.includes('page=2'));
  assert.strictEqual(body, null);
});

test('buildRequest on POST puts body params into JSON body', () => {
  const tools = buildTools(SAMPLE_OAS);
  const create = tools.find(t => t.name === 'create_ticket');
  const { url, body } = buildRequest(
    'https://acme.freshdesk.com/api/v2',
    create._meta,
    { subject: 'Hello', status: 2, tags: ['x'] }
  );
  assert.strictEqual(url, 'https://acme.freshdesk.com/api/v2/tickets');
  assert.deepStrictEqual(body, { subject: 'Hello', status: 2, tags: ['x'] });
});

test('buildRequest on PUT substitutes path param AND builds body', () => {
  const tools = buildTools(SAMPLE_OAS);
  const update = tools.find(t => t.name === 'update_ticket');
  const { url, body } = buildRequest(
    'https://acme.freshdesk.com/api/v2',
    update._meta,
    { ticket_id: 42, status: 4 }
  );
  assert.strictEqual(url, 'https://acme.freshdesk.com/api/v2/tickets/42');
  assert.deepStrictEqual(body, { status: 4 });
});

test('buildRequest on DELETE never includes a body', () => {
  const tools = buildTools(SAMPLE_OAS);
  const del = tools.find(t => t.name === 'delete_ticket');
  const { url, body } = buildRequest(
    'https://acme.freshdesk.com/api/v2',
    del._meta,
    { ticket_id: 42 }
  );
  assert.strictEqual(url, 'https://acme.freshdesk.com/api/v2/tickets/42');
  assert.strictEqual(body, null);
});

test('buildRequest omits body when POST has no body args provided', () => {
  const tools = buildTools(SAMPLE_OAS);
  const create = tools.find(t => t.name === 'create_ticket');
  const { body } = buildRequest('https://acme.freshdesk.com/api/v2', create._meta, {});
  assert.strictEqual(body, null);
});

test('findMissingRequired returns [] when all required args are present', () => {
  const schema = { required: ['ticket_id'], properties: { ticket_id: {} } };
  assert.deepStrictEqual(findMissingRequired(schema, { ticket_id: 42 }), []);
});

test('findMissingRequired reports keys absent from args', () => {
  const schema = { required: ['subject', 'status'], properties: {} };
  assert.deepStrictEqual(findMissingRequired(schema, { subject: 'Hi' }), ['status']);
});

test('findMissingRequired treats null and empty-string as missing', () => {
  const schema = { required: ['ticket_id'], properties: {} };
  assert.deepStrictEqual(findMissingRequired(schema, { ticket_id: null }), ['ticket_id']);
  assert.deepStrictEqual(findMissingRequired(schema, { ticket_id: '' }), ['ticket_id']);
});

test('findMissingRequired returns [] when schema has no required array', () => {
  assert.deepStrictEqual(findMissingRequired({ properties: {} }, {}), []);
});

test('freshdeskFetch error message shows the substituted URL, not the raw {placeholder} path', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: async () => '{"description":"Not found"}',
  });
  try {
    const meta = { method: 'GET', path: '/tickets/{ticket_id}', pathParams: ['ticket_id'], queryParams: [], bodyParams: [] };
    await assert.rejects(
      () => freshdeskFetch('https://acme.freshdesk.com/api/v2', 'Basic x', meta, { ticket_id: 1 }),
      (err) => {
        assert.match(err.message, /\/tickets\/1\b/);
        assert.doesNotMatch(err.message, /\{ticket_id\}/);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizeTicketListing passes through list_tickets with only a filter preset', () => {
  const result = normalizeTicketListing('list_tickets', { filter: 'open' });
  assert.deepStrictEqual(result, { toolName: 'list_tickets', args: { filter: 'open' } });
});

test('normalizeTicketListing passes through search_tickets with only a query', () => {
  const result = normalizeTicketListing('search_tickets', { query: 'status:4' });
  assert.deepStrictEqual(result, { toolName: 'search_tickets', args: { query: 'status:4' } });
});

test('normalizeTicketListing redirects list_tickets with agent_id/status to search_tickets', () => {
  const result = normalizeTicketListing('list_tickets', { agent_id: 50000418897, status: 'open' });
  assert.strictEqual(result.toolName, 'search_tickets');
  assert.strictEqual(result.args.query, 'agent_id:50000418897 AND status:2');
});

test('normalizeTicketListing normalizes status and priority words to Freshdesk numeric codes', () => {
  const result = normalizeTicketListing('list_tickets', { status: 'resolved', priority: 'urgent' });
  assert.strictEqual(result.args.query, 'status:4 AND priority:4');
});

test('normalizeTicketListing leaves an already-numeric status untouched', () => {
  const result = normalizeTicketListing('list_tickets', { status: 2 });
  assert.strictEqual(result.args.query, 'status:2');
});

test('normalizeTicketListing merges flat fields with an existing search_tickets query', () => {
  const result = normalizeTicketListing('search_tickets', { agent_id: 5, query: 'tag:billing' });
  assert.strictEqual(result.args.query, 'agent_id:5 AND (tag:billing)');
});

test('normalizeTicketListing preserves page when redirecting', () => {
  const result = normalizeTicketListing('list_tickets', { status: 'open', page: 2 });
  assert.strictEqual(result.args.page, 2);
});

test('normalizeTicketListing leaves non-ticket-listing tools untouched', () => {
  const result = normalizeTicketListing('get_ticket', { ticket_id: 1 });
  assert.deepStrictEqual(result, { toolName: 'get_ticket', args: { ticket_id: 1 } });
});

test('shrinkForModel leaves small results completely untouched', () => {
  const ticket = { id: 1, subject: 'Hi', description: 'a'.repeat(400) };
  assert.deepStrictEqual(shrinkForModel(ticket), ticket);
});

test('shrinkForModel leaves a single large-but-under-threshold field alone', () => {
  const ticket = { id: 1, description: 'x'.repeat(600) };
  assert.deepStrictEqual(shrinkForModel(ticket), ticket);
});

test('shrinkForModel truncates long string fields once overall size exceeds the threshold', () => {
  const bigDescription = 'x'.repeat(9000);
  const result = shrinkForModel({ id: 1, description: bigDescription });
  assert.ok(result.description.length < bigDescription.length);
  assert.match(result.description, /truncated, 9000 chars total/);
});

test('shrinkForModel caps array length and adds a "more not shown" marker', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: i, subject: 'x'.repeat(300) }));
  const result = shrinkForModel({ results: items });
  assert.strictEqual(result.results.length, 11); // 10 items + 1 marker string
  assert.strictEqual(result.results[10], '… 30 more item(s) not shown');
});

test('shrinkForModel recurses into nested objects and arrays', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    nested: { blob: 'y'.repeat(700) },
  }));
  const result = shrinkForModel({ page: { results: items } });
  assert.strictEqual(result.page.results.length, 11);
  assert.match(result.page.results[0].nested.blob, /truncated, 700 chars total/);
});

test('shrinkForModel caps object key count and adds a marker key', () => {
  const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field_${i}`, i]));
  const result = shrinkForModel({ id: 1, custom_fields: wide, padding: 'z'.repeat(9000) });
  assert.strictEqual(Object.keys(result.custom_fields).length, 16); // 15 kept + 1 marker
  assert.strictEqual(result.custom_fields._more_fields_not_shown, 5);
});

test('shrinkForModel passes through null/undefined', () => {
  assert.strictEqual(shrinkForModel(null), null);
  assert.strictEqual(shrinkForModel(undefined), undefined);
});

test('stripUnknownArgs drops a field the model invented that is not in the schema', () => {
  const schema = { properties: { query: {}, page: {} } };
  const result = stripUnknownArgs(schema, { query: 'status:4', page: 1, per_page: 30 });
  assert.deepStrictEqual(result, { query: 'status:4', page: 1 });
});

test('stripUnknownArgs keeps all args when every key is declared', () => {
  const schema = { properties: { ticket_id: {} } };
  assert.deepStrictEqual(stripUnknownArgs(schema, { ticket_id: 5 }), { ticket_id: 5 });
});

test('stripUnknownArgs returns {} for a schema with no properties', () => {
  assert.deepStrictEqual(stripUnknownArgs({}, { foo: 1 }), {});
});

test('stripUnknownArgs handles undefined args', () => {
  assert.deepStrictEqual(stripUnknownArgs({ properties: { a: {} } }, undefined), {});
});
