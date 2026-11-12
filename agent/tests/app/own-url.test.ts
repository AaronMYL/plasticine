// 「在别的设备上用」的自己的网址（11-12《首次使用解耦》）：要登录才能读写；只收 https、不带登录信息、路径、查询；
// 设了以后 Plasticine 写给他的链接用它（环境变量照旧最先），清掉回到 @账号的网址；不进不用登录的账号状态。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { LOCAL_TOKEN_HEADER } from '../../shared/api/account.ts';
import { normalizeOwnUrl, OWN_URL_KEY } from '../../src/app/own-url.ts';
import { publicUrlSource } from '../../src/app/public-url.ts';
import { openTestState } from '../state/helpers.ts';
import { call, cookieFrom, json, startTestApp, type TestApp } from './helpers.ts';

const LOCAL_TOKEN = 'fake-local-token-for-tests';
const open: TestApp[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

async function signedIn(): Promise<{ t: TestApp; cookie: string }> {
  const t = await startTestApp([], { localToken: LOCAL_TOKEN });
  open.push(t);
  const reply = await call(t, 'POST', '/v2/account/setup', { headers: { [LOCAL_TOKEN_HEADER]: LOCAL_TOKEN },
    body: { displayName: '测试名', handle: null, password: 'fake-password-123', deviceName: '测试电脑' } });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  return { t, cookie: cookieFrom(reply) };
}

test('只收 https 网址：去掉末尾斜杠；http、带路径、查询、登录信息的都不收', () => {
  assert.equal(normalizeOwnUrl(' https://plasticine.example.test/ '), 'https://plasticine.example.test');
  assert.equal(normalizeOwnUrl('https://box.example.test:8443'), 'https://box.example.test:8443');
  for (const bad of ['http://plasticine.example.test', 'https://plasticine.example.test/app',
    'https://plasticine.example.test/?a=1', 'https://user:pass@plasticine.example.test', 'plasticine', '']) {
    assert.throws(() => normalizeOwnUrl(bad), /https/, bad);
  }
});

test('读写要登录；存下后读回来，清掉是 null；账号状态里不出现', async () => {
  const { t, cookie } = await signedIn();
  assert.equal((await call(t, 'GET', '/v2/account/own-url')).status, 401);
  assert.deepEqual(json(await call(t, 'GET', '/v2/account/own-url', { cookie })), { ownUrl: null });
  const saved = await call(t, 'PUT', '/v2/account/own-url', { cookie,
    body: { ownUrl: 'https://plasticine.example.test/' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(json(saved), { ownUrl: 'https://plasticine.example.test' });
  assert.deepEqual(json(await call(t, 'GET', '/v2/account/own-url', { cookie })),
    { ownUrl: 'https://plasticine.example.test' });
  assert.doesNotMatch(JSON.stringify(json(await call(t, 'GET', '/v2/account/state'))), /example\.test/);
  const bad = await call(t, 'PUT', '/v2/account/own-url', { cookie, body: { ownUrl: 'http://lan.example.test' } });
  assert.equal(bad.status, 400);
  const cleared = await call(t, 'PUT', '/v2/account/own-url', { cookie, body: { ownUrl: null } });
  assert.deepEqual(json(cleared), { ownUrl: null });
});

test('设了自己的网址：Plasticine 写的链接用它；环境变量还是最先', async () => {
  const t = await openTestState();
  try {
    const url = publicUrlSource(t.state, {});
    assert.equal(url(), 'http://127.0.0.1:8790');
    t.state.kernelSettings.set(OWN_URL_KEY, 'https://plasticine.example.test');
    assert.equal(url(), 'https://plasticine.example.test');
    assert.equal(publicUrlSource(t.state, { PLASTICINE_PUBLIC_URL: 'https://env.example.test' })(),
      'https://env.example.test');
    t.state.kernelSettings.set(OWN_URL_KEY, null);
    assert.equal(url(), 'http://127.0.0.1:8790');
  } finally {
    await t.cleanup();
  }
});
