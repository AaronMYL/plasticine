import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { openMaintenanceSocket, type MaintenanceSocket } from '../../src/app/maintenance-socket.ts';
import { openState, type StateService } from '../../src/state/index.ts';

let h: { state: StateService; close(): void };
let directory: string;
let socket: MaintenanceSocket | undefined;

beforeEach(async () => {
  const state = openState({ path: ':memory:' });
  h = { state, close: () => state.close() };
  directory = await mkdtemp(join(tmpdir(), 'plasticine-maint-'));
});

afterEach(async () => {
  await socket?.close();
  socket = undefined;
  h.close();
  await rm(directory, { recursive: true, force: true });
});

async function killedListener(path: string): Promise<void> {
  const script = `require('node:net').createServer().listen(${JSON.stringify(path)}, () => console.log('ready'))`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  await Promise.race([
    once(child.stdout, 'data'),
    exited.then(([code, signal]) => {
      throw new Error(`socket 测试进程在就绪前退出（code=${String(code)}, signal=${String(signal)}）`);
    }),
  ]);
  child.kill('SIGKILL');
  await exited;
  assert.ok((await stat(path)).isSocket());
}

function call(path: string, method: string, body: string): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: join(directory, 'maintenance.sock'), path, method,
      headers: { 'content-type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString()) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('maint socket has 0600 perms; POST command returns JSON result and records maintenance op', async () => {
  socket = await openMaintenanceSocket(join(directory, 'maintenance.sock'), { state: h.state });
  const info = await stat(join(directory, 'maintenance.sock'));
  assert.equal(info.mode & 0o777, 0o600);
  const body = JSON.stringify({ operationId: 'op-sock-1', op: 'inbox.archive', sources: ['patrol'],
    because: '把巡查的来信归档' });
  const reply = await call('/v1/maintenance', 'POST', body);
  assert.equal(reply.status, 200);
  assert.equal((reply.json as { replayed: boolean }).replayed, false);
  assert.equal(h.state.maintenanceOperations.get('op-sock-1')?.op, 'inbox.archive');
});

test('maint API: 400 on schema error or missing reason with details; 404 on unknown path', async () => {
  socket = await openMaintenanceSocket(join(directory, 'maintenance.sock'), { state: h.state });
  const bad = await call('/v1/maintenance', 'POST', JSON.stringify({ operationId: 'x', op: 'drop_everything' }));
  assert.equal(bad.status, 400);
  const noQuote = await call('/v1/maintenance', 'POST',
    JSON.stringify({ operationId: 'op-sock-2', op: 'inbox.archive', sources: ['patrol'] }));
  assert.equal(noQuote.status, 400);
  assert.equal((noQuote.json as { error: string }).error, 'because_required');
  const other = await call('/v1/other', 'POST', '{}');
  assert.equal(other.status, 404);
});

test('replaces stale maint socket file on startup; refuses and errors on non-socket file of same name', async () => {
  const path = join(directory, 'maintenance.sock');
  await killedListener(path);
  socket = await openMaintenanceSocket(path, { state: h.state });
  const reply = await call('/v1/maintenance', 'POST', JSON.stringify({ operationId: 'op-r', op: 'status' }));
  assert.equal(reply.status, 200);
  await socket.close();
  socket = undefined;
  await writeFile(path, '不是 socket');
  await assert.rejects(() => openMaintenanceSocket(path, { state: h.state }),
    /不是 socket/);
});
