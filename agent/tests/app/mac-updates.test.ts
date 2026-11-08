// Mac 自更新的服务端（第 102 条：Mac 自签、自己更新）：GET /v2/nodes/mac/latest 用节点 Bearer 拿 { version, sha256, url }，
// url 同源、同一 Bearer 下载 zip 字节。包在状态目录 downloads/mac/ 下（latest.json + zip，由 Mac 构建工作流的发布 job 写）。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { MacLatestResponseSchema } from '../../shared/api/index.ts';
import { MAC_DOWNLOADS_DIR, MAC_LATEST_FILE } from '../../src/app/mac-updates.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, registerKey, signedCall } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function pairedNode(app: TestApp): Promise<string> {
  const cookie = await pair(app);
  const key = newDeviceKey();
  assert.equal((await registerKey(app, cookie, key)).status, 201);
  const code = await signedCall(app, 'POST', '/v2/nodes/pairing-codes', { requestId: newRequestId('code') },
    { cookie, key });
  const reply = await call(app, 'POST', '/v2/nodes/pair', { body: { requestId: newRequestId('pair'),
    code: String(json(code)['code']), name: '家里的 Mac', platform: 'macos', appVersion: '0.1.0', protocolVersion: 1,
    capabilities: ['file_read'] } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return String(json(reply)['credential']);
}

async function publish(app: TestApp, version: string, bytes: Buffer): Promise<string> {
  const directory = join(app.directory, MAC_DOWNLOADS_DIR);
  await mkdir(directory, { recursive: true });
  const file = `Plasticine-${version}.zip`;
  await writeFile(join(directory, file), bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(directory, MAC_LATEST_FILE), JSON.stringify({ version, sha256, file,
    commit: 'abc1234', publishedAt: '2026-11-02T08:00:00Z' }));
  return sha256;
}

test('没有包时 404；有包时节点 Bearer 拿到版本、校验值和同源下载地址，同一 Bearer 下回 zip 字节', async () => {
  t = await startTestApp();
  const credential = await pairedNode(t);
  const authorization = { authorization: `Bearer ${credential}` };
  const missing = await call(t, 'GET', '/v2/nodes/mac/latest', { headers: authorization });
  assert.equal(missing.status, 404);
  const bytes = Buffer.from('PK\u0003\u0004 假的 zip 内容');
  const sha256 = await publish(t, '0.2.0', bytes);
  const latest = await call(t, 'GET', '/v2/nodes/mac/latest', { headers: authorization });
  assert.equal(latest.status, 200, JSON.stringify(latest.body));
  assert.ok(Value.Check(MacLatestResponseSchema, latest.body));
  const body = json(latest);
  assert.equal(body['version'], '0.2.0');
  assert.equal(body['sha256'], sha256);
  const url = new URL(String(body['url']));
  assert.equal(url.pathname, '/v2/nodes/mac/downloads/Plasticine-0.2.0.zip');
  const download = await call(t, 'GET', url.pathname, { headers: authorization });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  assert.deepEqual(Buffer.from(download.body as ArrayBuffer), bytes);
});

test('没有或错的节点凭证 401，不给版本也不给字节；不是 latest.json 里那个包的文件名 404', async () => {
  t = await startTestApp();
  const credential = await pairedNode(t);
  await publish(t, '0.2.1', Buffer.from('zip'));
  assert.equal((await call(t, 'GET', '/v2/nodes/mac/latest')).status, 401);
  const wrong = await call(t, 'GET', '/v2/nodes/mac/latest', { headers: { authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  assert.equal((await call(t, 'GET', '/v2/nodes/mac/downloads/Plasticine-0.2.1.zip')).status, 401);
  const headers = { authorization: `Bearer ${credential}` };
  assert.equal((await call(t, 'GET', '/v2/nodes/mac/downloads/other.zip', { headers })).status, 404);
  assert.equal((await call(t, 'GET', '/v2/nodes/mac/downloads/..%2Flatest.json', { headers })).status, 404);
});

test('latest.json 写坏了或指的包不在：不给半截信息，说包不可用（503 / 404）', async () => {
  t = await startTestApp();
  const credential = await pairedNode(t);
  const headers = { authorization: `Bearer ${credential}` };
  const directory = join(t.directory, MAC_DOWNLOADS_DIR);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, MAC_LATEST_FILE), '{"version":');
  assert.equal((await call(t, 'GET', '/v2/nodes/mac/latest', { headers })).status, 503);
  await writeFile(join(directory, MAC_LATEST_FILE), JSON.stringify({ version: '0.3.0', sha256: 'a'.repeat(64),
    file: 'Plasticine-0.3.0.zip' }));
  assert.equal((await call(t, 'GET', '/v2/nodes/mac/latest', { headers })).status, 404);
});
