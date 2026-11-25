import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Connections, createConnectionTools, CredentialFiles } from '../../src/cloud-tools/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { toolContext } from '../tools/helpers.ts';

let h: TestState;
let directory: string;
let url: string;
let seen: { method: string; auth: string | undefined; session: string | undefined }[];
let close: () => Promise<void>;

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
}

beforeEach(async () => {
  h = await openTestState();
  directory = mkdtempSync(join(tmpdir(), 'connections-'));
  seen = [];
  const server = createServer((req, res) => {
    void body(req).then((message) => {
      seen.push({ method: String(message['method']), auth: req.headers.authorization,
        session: req.headers['mcp-session-id'] as string | undefined });
      const reply = (result: unknown, sse = false): void => {
        const text = JSON.stringify({ jsonrpc: '2.0', id: message['id'], result });
        res.setHeader('mcp-session-id', 'session-1');
        if (sse) {
          res.setHeader('content-type', 'text/event-stream');
          res.end(`event: message\ndata: ${text}\n\n`);
        } else {
          res.setHeader('content-type', 'application/json');
          res.end(text);
        }
      };
      if (message['method'] === 'initialize') reply({ protocolVersion: '2025-06-18', capabilities: {} });
      else if (message['method'] === 'notifications/initialized') res.writeHead(202).end();
      else if (message['method'] === 'tools/list') reply({ tools: [
        { name: 'search_pages', description: '搜页面', annotations: { readOnlyHint: true },
          inputSchema: { type: 'object' } },
        { name: 'create_page', description: '新建页面', inputSchema: { type: 'object' } }] }, true);
      else if (message['method'] === 'tools/call') reply({ content: [{ type: 'text', text: '找到 2 页' }] }, true);
      else res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  close = () => new Promise((resolve) => server.close(() => resolve()));
});

afterEach(async () => {
  await close();
  rmSync(directory, { recursive: true, force: true });
  await h.cleanup();
});

function connections(): Connections {
  return new Connections({ state: h.state, credentials: new CredentialFiles(directory), allowLocal: true });
}

test('adding connection tests token, records tools/read-only flags; UI shows only token-configured', async () => {
  const service = connections();
  const view = await service.create({ name: 'Notion', url, token: 'tok-example-1' }, AbortSignal.timeout(5_000));
  assert.equal(view.status, 'ok');
  assert.equal(view.hasToken, true);
  assert.ok(!JSON.stringify(view).includes('tok-example-1'));
  assert.deepEqual(view.tools.map((tool) => [tool.name, tool.readOnly]), [['search_pages', true],
    ['create_page', false]]);
  assert.equal(seen[0]?.auth, 'Bearer tok-example-1');
  assert.equal(seen.find((item) => item.method === 'tools/list')?.session, 'session-1');
  await assert.rejects(service.create({ name: 'notion', url }, AbortSignal.timeout(5_000)), /已经有一个/);
});

test('connection_call skips grant for read-only, declares scope for writes, returns remote text', async () => {
  const service = connections();
  await service.create({ name: 'Notion', url }, AbortSignal.timeout(5_000));
  const [list, call] = createConnectionTools(service);
  assert.ok(list !== undefined && call !== undefined);
  assert.equal(call.outbound?.({ connection: 'Notion', tool: 'search_pages', arguments: { q: 'x' } }), null);
  assert.deepEqual(call.outbound?.({ connection: 'notion', tool: 'create_page', arguments: { title: '周报' } }),
    { channel: 'connection:notion', account: 'connection:notion', recipients: ['create_page'], category: 'write',
      content: '{"title":"周报"}' });
  assert.equal(await call.execute({ connection: 'Notion', tool: 'search_pages', arguments: {} }, toolContext('c1')),
    '找到 2 页');
  const listed = JSON.parse(await list.execute({}, toolContext('c2'))) as { connections: { name: string }[] };
  assert.deepEqual(listed.connections.map((item) => item.name), ['Notion']);
});

test('accepts public https only; rejects localhost and private network addresses', async () => {
  const service = new Connections({ state: h.state, credentials: new CredentialFiles(directory) });
  await assert.rejects(service.create({ name: '本机', url: 'https://127.0.0.1/mcp' }, AbortSignal.timeout(1_000)));
  assert.equal(h.state.connections.list().length, 0);
});
