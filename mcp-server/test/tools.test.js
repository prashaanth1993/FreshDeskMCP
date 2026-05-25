import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { applyMineFilter, buildRequest, buildTools, buildUrl } from '../tools.js';

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
