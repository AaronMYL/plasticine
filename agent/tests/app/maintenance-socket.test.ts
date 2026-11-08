// 第 115 条：维护入口只在本机 unix socket 上收，文件权限 0600（只有 plasticine 用户能连，Caddy 够不着）；
// 只认 POST /v1/maintenance 的 JSON；参数不合 schema 回 400 和一句中文；上次没删掉的旧 socket 文件换成新的。

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { openMaintenanceSocket, type MaintenanceSocket } from '../../src/app/maintenance-socket.ts';
import { ensureIntake } from '../../src/intake/index.ts';
import { openState, type StateService } from '../../src/state/index.ts';

let h: { state: StateService; close(): void };
let directory: string;
let socket: MaintenanceSocket | undefined;

beforeEach(async () => {
  const state = openState({ path: ':memory:' });
  ensureIntake(state);
  h = { state, close: () => state.close() };
  directory = await mkdtemp(join(tmpdir(), 'plasticine-maint-'));
});

afterEach(async () => {
  await socket?.close();
  socket = undefined;
  h.close();
  await rm(directory, { recursive: true, force: true });
});

/** 另起一个进程在 path 上听，然后直接杀掉：socket 文件留下、没人在听（服务被杀的样子）。 */
async function killedListener(path: string): Promise<void> {
  const script = `require('node:net').createServer().listen(${JSON.stringify(path)}, () => console.log('ready'))`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  // 不支持 Unix socket 的环境会在 ready 前退出；必须报告错误，不能让整个测试队列永远等 stdout。
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

test('socket 权限 0600；POST 一条维护命令，回 JSON 结果，规则真的改了', async () => {
  socket = await openMaintenanceSocket(join(directory, 'maintenance.sock'), { state: h.state });
  const info = await stat(join(directory, 'maintenance.sock'));
  assert.equal(info.mode & 0o777, 0o600);
  const body = JSON.stringify({ operationId: 'op-sock-1', op: 'rules.mode', code: 'feed_interest', mode: 'auto',
    because: '打开收录' });
  const reply = await call('/v1/maintenance', 'POST', body);
  assert.equal(reply.status, 200);
  assert.equal((reply.json as { replayed: boolean }).replayed, false);
  assert.equal(h.state.rules.byCode('feed_interest')?.mode, 'auto');
});

test('参数不合 schema 回 400；缺原话回 400 带原因；别的路径 404', async () => {
  socket = await openMaintenanceSocket(join(directory, 'maintenance.sock'), { state: h.state });
  const bad = await call('/v1/maintenance', 'POST', JSON.stringify({ operationId: 'x', op: 'drop_everything' }));
  assert.equal(bad.status, 400);
  const noQuote = await call('/v1/maintenance', 'POST',
    JSON.stringify({ operationId: 'op-sock-2', op: 'rules.mode', code: 'feed_interest', mode: 'auto' }));
  assert.equal(noQuote.status, 400);
  assert.equal((noQuote.json as { error: string }).error, 'because_required');
  const other = await call('/v1/other', 'POST', '{}');
  assert.equal(other.status, 404);
});

test('上次留下的旧 socket 文件换成新的；不是 socket 的同名文件不碰，报错', async () => {
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
