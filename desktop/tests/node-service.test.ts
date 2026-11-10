import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import type { DeviceServiceStatus } from '../../agent/shared/api/desktop-bridge.ts';
import { ActionJournal } from '../src/node/action-journal.ts';
import { CredentialStore } from '../src/node/credential-store.ts';
import { NodeApi } from '../src/node/node-api.ts';
import { NodeService } from '../src/node/node-service.ts';
import { tempDir } from './helpers.ts';

const LIMITS = { roots: [], apps: [], sites: [], unattendedInput: true, classes: {
  read: { mode: 'allow', perHour: 10 }, write: { mode: 'allow', perHour: 10 }, delete: { mode: 'confirm_each',
    perHour: 10 }, command: { mode: 'allow', perHour: 10 }, browser: { mode: 'allow', perHour: 10 },
  input: { mode: 'allow', perHour: 10 } } };

interface FakeServer {
  url: string;
  results: { id: string; body: unknown }[];
  hellos: unknown[];
  queue: unknown[];
  authorized: boolean;
  close(): Promise<void>;
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
  }
  return text === '' ? null : JSON.parse(text);
}

async function fakeServer(): Promise<FakeServer> {
  const state = { results: [] as { id: string; body: unknown }[], hellos: [] as unknown[], queue: [] as unknown[],
    authorized: true };
  const send = (res: ServerResponse, status: number, value?: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(value === undefined ? '' : JSON.stringify(value));
  };
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '').split('?')[0];
      const value = await body(req);
      if (path === '/v2/nodes/pair') {
        send(res, 201, { nodeId: 'node-1', credential: 'cred-1', limits: LIMITS, limitsVersion: 1 });
      } else if (!state.authorized || req.headers.authorization !== 'Bearer cred-1') {
        send(res, 401, { error: 'no' });
      } else if (path === '/v2/nodes/hello') {
        state.hellos.push(value);
        send(res, 200, { nodeId: 'node-1', limits: LIMITS, limitsVersion: 1 });
      } else if (path === '/v2/nodes/actions/next') {
        const action = state.queue.shift();
        if (action === undefined) {
          setTimeout(() => send(res, 204), 50);
        } else {
          send(res, 200, { action });
        }
      } else if (path?.startsWith('/v2/nodes/actions/') === true) {
        state.results.push({ id: decodeURIComponent(path.split('/')[4] ?? ''), body: value });
        send(res, 200, {});
      } else {
        send(res, 404, {});
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return Object.assign(state, { url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) });
}

function service(dir: string, executed: string[],
  journal = (server: string, nodeId: string) => new ActionJournal(join(dir, 'actions'), server, nodeId)): NodeService {
  const credentials = new CredentialStore(join(dir, 'cred'), null, { available: () => true,
    encrypt: (text) => Buffer.from(text), decrypt: (data) => data.toString() });
  return new NodeService({
    api: (server) => new NodeApi(server, fetch),
    credentials,
    journal,
    runner: {
      capabilities: async () => ['file_read', 'tab_list'],
      execute: async (action) => {
        executed.push(action.id);
        return { status: 'executed', result: { content: 'x' } };
      },
      missing: async () => ['screen'],
    },
    identity: { name: '测试电脑', platform: 'linux', appVersion: '0.0.0' },
    idleSeconds: async () => 7,
    requestId: () => 'request-0001',
    sleep: (ms, signal) => new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(ms, 20));
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    }),
    now: () => Date.now(),
    log: () => undefined,
  }, false);
}

function until(node: NodeService, wanted: (status: DeviceServiceStatus) => boolean): Promise<DeviceServiceStatus> {
  return new Promise((resolve) => {
    if (wanted(node.status())) {
      resolve(node.status());
      return;
    }
    const off = node.onChange((status) => {
      if (wanted(status)) {
        off();
        resolve(status);
      }
    });
  });
}

test('没配对时等着；配对后 hello、领动作、做、交回执，同一个 id 只做一次', async (t) => {
  const server = await fakeServer();
  const dir = tempDir(t);
  const executed: string[] = [];
  const node = service(dir, executed);
  t.after(async () => { node.stop(); await server.close(); });
  node.useServer(server.url);
  await until(node, (status) => status.state === 'unpaired' && status.capabilities.length > 0);
  const action = { id: 'act-1', kind: 'file_read', params: { path: '~/a' }, deadline: '2026-11-08T10:00:00.000Z' };
  server.queue.push(action, action);
  await node.pair('ABCD-1234');
  await until(node, (status) => status.state === 'online');
  while (server.results.length < 1 || server.queue.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(executed, ['act-1']);
  assert.deepEqual(server.results, [{ id: 'act-1', body: { status: 'executed', result: { content: 'x' } } }]);
  assert.deepEqual(server.hellos[0], { appVersion: '0.0.0', protocolVersion: 1, capabilities: ['file_read', 'tab_list'],
    idleSeconds: 7 });
  assert.deepEqual(node.status().missing, ['screen']);
});

test('本体不认凭证了（401）：停下来显示要重新配对', async (t) => {
  const server = await fakeServer();
  const dir = tempDir(t);
  const node = service(dir, []);
  t.after(async () => { node.stop(); await server.close(); });
  node.useServer(server.url);
  await until(node, (status) => status.state === 'unpaired');
  await node.pair('ABCD-1234');
  await until(node, (status) => status.state === 'online');
  server.authorized = false;
  const status = await until(node, (value) => value.state === 'repair');
  assert.match(status.problem ?? '', /重新配对/);
  assert.equal(node.credential(), null);
});

test('非法动作编号交回 refused，继续接下一步，不执行也不破坏回执记录', { timeout: 3_000 }, async (t) => {
  const server = await fakeServer();
  const executed: string[] = [];
  const node = service(tempDir(t), executed);
  t.after(async () => { node.stop(); await server.close(); });
  node.useServer(server.url);
  await until(node, (status) => status.state === 'unpaired');
  const invalidIds = ['call_fixture|fc_fixture', 'x'.repeat(201), '../outside'];
  for (const id of [...invalidIds, 'valid-next']) {
    server.queue.push({ id, kind: 'file_read', params: { path: '~/a' }, deadline: '2099-01-01T00:00:00.000Z' });
  }
  await node.pair('ABCD-1234');
  const deadline = Date.now() + 1_500;
  while (server.results.length < invalidIds.length + 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(server.results.length, invalidIds.length + 1);
  assert.deepEqual(executed, ['valid-next']);
  for (const [index, id] of invalidIds.entries()) {
    assert.deepEqual(server.results[index], { id,
      body: { status: 'refused', refusalLayer: 'device', error: '动作编号不合规，这一步没有执行。' } });
  }
});

test('回执开始记录失败也交回 refused，不让动作成为无回执的空洞', async (t) => {
  const server = await fakeServer();
  const executed: string[] = [];
  class BrokenJournal extends ActionJournal {
    override begin(): void { throw new Error('测试回执存储失败'); }
  }
  const dir = tempDir(t);
  const node = service(dir, executed, (origin, nodeId) => new BrokenJournal(dir, origin, nodeId));
  t.after(async () => { node.stop(); await server.close(); });
  node.useServer(server.url);
  await until(node, (status) => status.state === 'unpaired');
  server.queue.push({ id: 'begin-failure', kind: 'file_read', params: { path: '~/a' },
    deadline: '2099-01-01T00:00:00.000Z' });
  await node.pair('ABCD-1234');
  const deadline = Date.now() + 1_500;
  while (server.results.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(executed, []);
  assert.deepEqual(server.results, [{ id: 'begin-failure',
    body: { status: 'refused', refusalLayer: 'device',
      error: '这台电脑无法保存动作回执，这一步没有执行。请检查存储空间或回执记录。' } }]);
});

test('复合与超长编号映射后可保存回执，重启重放也只执行一次', async (t) => {
  const server = await fakeServer();
  const dir = tempDir(t);
  const executed: string[] = [];
  let node = service(dir, executed);
  t.after(async () => { node.stop(); await server.close(); });
  node.useServer(server.url);
  await until(node, (status) => status.state === 'unpaired');
  const actions = ['call_fixture|fc_fixture', `call_${'x'.repeat(250)}`].map((original) => ({
    id: `a-${createHash('sha256').update(original).digest('hex').slice(0, 40)}`,
    kind: 'file_read', params: { path: '~/a' }, deadline: '2099-01-01T00:00:00.000Z',
  }));
  server.queue.push(...actions, ...actions);
  await node.pair('ABCD-1234');
  const deadline = Date.now() + 1_500;
  while ((server.results.length < 2 || server.queue.length > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(server.queue.length, 0);
  assert.deepEqual(executed, actions.map((action) => action.id));
  node.stop();
  node = service(dir, executed);
  server.queue.push(...actions);
  node.useServer(server.url);
  await until(node, (status) => status.state === 'online');
  const restartedDeadline = Date.now() + 1_500;
  while (server.queue.length > 0 && Date.now() < restartedDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(server.queue.length, 0);
  assert.deepEqual(executed, actions.map((action) => action.id));
  assert.equal(server.results.length, 2);
});

test('远程只认 https；这台电脑上的本体可以是 http', () => {
  assert.throws(() => new NodeApi('http://example.com/', fetch), /https/);
  assert.equal(new NodeApi('http://127.0.0.1:8790/v2', fetch).origin, 'http://127.0.0.1:8790/');
});
