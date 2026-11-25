import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MIGRATION_CHUNK_BYTES, type MigrationStatus } from '../../shared/api/index.ts';
import { readPending } from '../../src/system/index.ts';
import { call, cookieFrom, json, newRequestId, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function status(app: TestApp, cookie: string): Promise<MigrationStatus> {
  return json(await call(app, 'GET', '/v2/migration', { cookie })) as unknown as MigrationStatus;
}

async function until(read: () => Promise<boolean>): Promise<void> {
  for (let tries = 0; tries < 400; tries += 1) {
    if (await read()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail('等不到');
}

test('full export -> download -> chunked upload -> wrong passphrase error -> unpack -> merge prompt', async () => {
  let restarts = 0;
  t = await startTestApp([], { startTasks: false, migrationRestart: () => { restarts += 1; } });
  const app = t;
  const cookie = await pair(app);
  app.state.notes.create({ markdown: '# 示例笔记\n内容', author: 'user', folder: '日常' });
  const short = await call(app, 'POST', '/v2/migration/export', { cookie,
    body: { requestId: newRequestId(), mode: 'full', passphrase: 'short' } });
  assert.equal(short.status, 400);
  const noPass = await call(app, 'POST', '/v2/migration/export', { cookie,
    body: { requestId: newRequestId(), mode: 'full' } });
  assert.equal(noPass.status, 400);
  const started = await call(app, 'POST', '/v2/migration/export', { cookie,
    body: { requestId: newRequestId(), mode: 'full', passphrase: 'fake migration pass' } });
  assert.equal(started.status, 200);
  await until(async () => (await status(app, cookie)).export?.state === 'ready');
  const file = await call(app, 'GET', '/v2/migration/export/file', { cookie });
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition') ?? '', /attachment; filename\*=UTF-8''plasticine-/);
  const bytes = Buffer.from(file.body as ArrayBuffer);
  assert.equal(bytes.subarray(0, 8).toString('ascii'), 'PLSTMIG1');

  const begun = await call(app, 'POST', '/v2/migration/import', { cookie,
    body: { requestId: newRequestId(), name: 'back.plasticine', bytes: bytes.length } });
  assert.equal(begun.status, 200);
  for (let offset = 0; offset < bytes.length; offset += MIGRATION_CHUNK_BYTES) {
    const chunk = await fetch(`${app.base}/v2/migration/import/chunks/${offset}`, { method: 'PUT',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: bytes.subarray(offset, offset + MIGRATION_CHUNK_BYTES) });
    assert.equal(chunk.status, 200);
  }
  const done = await call(app, 'POST', '/v2/migration/import/complete', { cookie, body: {} });
  assert.equal((json(done) as unknown as MigrationStatus).import?.state, 'locked');
  const wrong = await call(app, 'POST', '/v2/migration/import/unlock', { cookie,
    body: { passphrase: 'not the right one' } });
  assert.equal(wrong.status, 400);
  assert.match(String(json(wrong)['error']), /口令不对/);
  const right = await call(app, 'POST', '/v2/migration/import/unlock', { cookie,
    body: { passphrase: 'fake migration pass' } });
  assert.equal(right.status, 200);
  assert.equal((json(right) as unknown as MigrationStatus).import?.summary?.counts.notes, 1);
  await until(async () => (await status(app, cookie)).import?.state === 'staged');
  const applied = await call(app, 'POST', '/v2/migration/import/apply', { cookie,
    body: { requestId: newRequestId(), how: 'merge' } });
  assert.equal(applied.status, 200);
  assert.equal(json(applied)['restarting'], true);
  assert.equal(restarts, 1);
  assert.equal(readPending(app.directory)?.kind, 'merge');
});

test('internal browser system session cannot export, import, or check migration status', async () => {
  t = await startTestApp([], { startTasks: false, migrationRestart: () => undefined });
  const app = t;
  const user = await pair(app);
  const device = app.state.devices.list()[0]!;
  const nodes = app.app.deps.devices;
  const issued = nodes.issueCode(device.id);
  const paired = nodes.pair(nodes.findCode(issued.code)!, { code: issued.code, requestId: newRequestId(),
    name: 'Mac', platform: 'macos', appVersion: '0.7.4', protocolVersion: 1, capabilities: ['tab_open'] });
  const opened = await call(app, 'POST', '/v2/nodes/browser-session', {
    headers: { authorization: `Bearer ${paired.credential}` }, body: {} });
  const system = cookieFrom(opened);
  for (const [method, path, body] of [['GET', '/v2/migration', undefined],
    ['POST', '/v2/migration/export', { requestId: newRequestId(), mode: 'data' }],
    ['GET', '/v2/migration/export/file', undefined],
    ['POST', '/v2/migration/import', { requestId: newRequestId(), name: 'x.plasticine', bytes: 10 }]] as const) {
    const denied = await call(app, method, path, { cookie: system, ...(body === undefined ? {} : { body }) });
    assert.equal(denied.status, 403, path);
    assert.equal(json(denied)['code'], 'user_confirmation_required', path);
  }
  assert.equal((await call(app, 'GET', '/v2/migration', { cookie: user })).status, 200);
  assert.equal((await call(app, 'GET', '/v2/migration/export/file', { cookie: user })).status, 404);
});
