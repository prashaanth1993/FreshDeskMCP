import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'js-yaml';
import { buildTools, buildUrl } from '../tools.js';

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
`);

test('buildTools returns one tool per operationId', () => {
  const tools = buildTools(SAMPLE_OAS);
  assert.strictEqual(tools.length, 2);
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
