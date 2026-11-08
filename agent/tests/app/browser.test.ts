import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CdpBrowser, CloudToolError, type BrowserAction, type BrowserTransport } from '../../src/cloud-tools/index.ts';
import type { BrowserViewDto } from '../../shared/api/browser.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';
import { fakeCdp } from '../cloud-tools/fake-cdp.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});
async function current(app: TestApp, cookie: string): Promise<BrowserViewDto> {
  return json(await call(app, 'GET', '/v2/browser', { cookie }))['browser'] as BrowserViewDto;
}
async function openPage(app: TestApp, cookie: string): Promise<string> {
  const instanceId = (await current(app, cookie)).instanceId ?? '';
  const body = { requestId: newRequestId('op'), instanceId, url: 'https://example.com/' };
  assert.equal((await call(app, 'POST', '/v2/browser/open', { cookie, body })).status, 200);
  return instanceId;
}
function fakeBrowser(options: { cutNext?: () => boolean } = {}) {
  const actions: BrowserAction[] = [];
  const transport: BrowserTransport = {
    open: async (url) => ({ sessionId: 's1', url, title: '示例' }),
    act: async (_session, action) => {
      actions.push(action);
      if (options.cutNext?.() === true) {
        throw new CloudToolError('unknown', '连接断了，请核对画面后重试。');
      }
      return { sessionId: 's1', url: 'https://example.com/', title: '示例' };
    },
    frame: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    text: async () => '页面上的字',
  };
  return { transport, actions };
}

test('浏览器需要登录；HTTP 和 HTTPS 经 cleanUrl 导航，拒绝其他协议，PNG 不缓存', async () => {
  const fake = fakeBrowser();
  t = await startTestApp([], { cloudTransports: { browser: fake.transport } });
  assert.equal((await call(t, 'GET', '/v2/browser')).status, 401);
  assert.equal((await call(t, 'GET', '/v2/browser/stream')).status, 401);
  const cookie = await pair(t);
  const instanceId = (await current(t, cookie)).instanceId;
  const opened = await call(t, 'POST', '/v2/browser/open', { cookie, body: {
    requestId: newRequestId('op'), instanceId, url: 'http://example.com/a?keyword=a%20b&token=discard',
  } });
  assert.equal(opened.status, 200);
  assert.equal((json(opened)['browser'] as BrowserViewDto).url, 'http://example.com/a?keyword=a%20b');
  const invalid = await call(t, 'POST', '/v2/browser/open', { cookie, body: {
    requestId: newRequestId('op'), instanceId, url: 'file:///tmp/example',
  } });
  assert.equal(invalid.status, 400);
  const frame = await call(t, 'GET', '/v2/browser/frame', { cookie });
  assert.equal(frame.headers.get('content-type'), 'image/png');
  assert.equal(frame.headers.get('cache-control'), 'no-store');
});

test('用户操作在干跑中照常做；重发不重复，输入内容不进回执或库文件', async () => {
  const fake = fakeBrowser();
  t = await startTestApp([], { cloudTransports: { browser: fake.transport } });
  const cookie = await pair(t);
  const instanceId = await openPage(t, cookie);
  const text = '这段中文只在浏览器内存里';
  const body = { requestId: newRequestId('ac'), instanceId, tabId: 's1', action: { kind: 'type', text } };
  assert.equal(json(await call(t, 'POST', '/v2/browser/actions', { cookie, body }))['outcome'], 'done');
  assert.equal(json(await call(t, 'POST', '/v2/browser/actions', { cookie, body }))['outcome'], 'done');
  assert.equal(fake.actions.length, 1);
  assert.equal(t.state.receipts.get(`browser:${body.requestId}`), undefined);
  const changed = await call(t, 'POST', '/v2/browser/actions', { cookie, body: {
    ...body, action: { kind: 'back' },
  } });
  assert.equal(changed.status, 400);
  assert.equal((await readFile(join(t.directory, 'plasticine.sqlite'))).includes(Buffer.from(text)), false);
  assert.equal((await readFile(join(t.directory, 'plasticine.sqlite-wal'))).includes(Buffer.from(text)), false);
});

test('未知操作不自动重放，重启后旧 instanceId 失效', async () => {
  const fake = fakeBrowser({ cutNext: () => true });
  t = await startTestApp([], { cloudTransports: { browser: fake.transport } });
  const cookie = await pair(t);
  const instanceId = await openPage(t, cookie);
  const body = { requestId: newRequestId('ac'), instanceId, tabId: 's1', action: { kind: 'click', x: 1, y: 1 } };
  assert.equal((await call(t, 'POST', '/v2/browser/actions', { cookie, body })).status, 409);
  assert.equal((await call(t, 'POST', '/v2/browser/actions', { cookie, body })).status, 409);
  assert.equal(fake.actions.length, 1);
  const directory = t.directory;
  await t.close(true);
  t = await startTestApp([], { directory, cloudTransports: { browser: fake.transport } });
  assert.equal((await call(t, 'POST', '/v2/browser/actions', { cookie, body })).status, 400);
  assert.equal(fake.actions.length, 1);
});

test('浏览器没起来时返回可重试状态，不假装已有页面', async (ctx) => {
  const fake = await fakeCdp();
  const endpoint = fake.endpoint;
  await fake.close();
  const transport = new CdpBrowser({ endpoint });
  ctx.after(() => transport.close());
  t = await startTestApp([], { cloudTransports: { browser: transport } });
  const cookie = await pair(t);
  const view = await current(t, cookie);
  assert.equal(view.available, false);
  assert.equal(view.open, false);
});

test('手动操作必须绑定当前标签，缺少标签或旧标签请求不发送输入', async () => {
  const fake = fakeBrowser();
  t = await startTestApp([], { cloudTransports: { browser: fake.transport } });
  const cookie = await pair(t);
  const instanceId = await openPage(t, cookie);
  const body = { requestId: newRequestId('ac'), instanceId, tabId: 's1', action: { kind: 'click', x: 1, y: 1 } };
  assert.equal((await call(t, 'POST', '/v2/browser/actions', { cookie, body })).status, 200);
  const { tabId: _tabId, ...withoutTab } = body;
  assert.equal((await call(t, 'POST', '/v2/browser/actions', { cookie,
    body: { ...withoutTab, requestId: newRequestId('ac') } })).status, 400);
  const stale = await call(t, 'POST', '/v2/browser/actions', { cookie,
    body: { ...body, requestId: newRequestId('ac'), tabId: 'old-tab' } });
  assert.equal(stale.status, 400);
  assert.equal(fake.actions.length, 1);
});
