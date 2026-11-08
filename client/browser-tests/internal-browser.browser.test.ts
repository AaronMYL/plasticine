// 真 Chromium + HTTP：云端浏览器写入的 Cookie 必须被正常鉴权识别为 system，不能继承导入的用户身份。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpBrowser } from '../../agent/src/cloud-tools/cdp-browser.ts';
import { startStack, until } from './helpers.ts';

test('自访网页无需再配对，真实 Cookie 覆盖用户登录；撤销只移除本站 Cookie', async (t) => {
  const { app, page, browser, base, cookie } = await startStack(t, { hash: '/notes', client: 'mac' });
  await until(page, 'document.querySelector(".shell-main") !== null', '已经配对的个人页面');
  const sessions = app.app.deps.browserSessions;
  const transport = new CdpBrowser({ endpoint: browser.endpoint, internalUrl: base,
    internalCookies: () => sessions.cookies(base) });
  t.after(() => transport.close());
  const signal = () => AbortSignal.timeout(15_000);
  const actor = () => page.evaluate<string>(`fetch('/v2/session').then(async response =>
    response.ok ? (await response.json()).actor ?? 'user' : String(response.status))`);
  assert.equal(await actor(), 'user');
  await page.send('Network.setCookie', { name: 'external_login', value: 'external-test',
    url: 'https://external.test/', httpOnly: true, secure: true });
  await transport.snapshot(signal());
  assert.equal(await actor(), 'system');
  await page.send('Page.reload');
  await until(page, 'document.querySelector(".shell-main") !== null', '系统浏览器直接打开内部页面');
  assert.equal(await actor(), 'system');
  const internalDevice = sessions.open().device;
  assert.equal(app.state.deviceKeys.liveFor(internalDevice.id), undefined,
    '系统页面不登记个人确认钥匙');
  const written = await page.evaluate<{ status: number; author: string }>(`fetch('/v2/notes', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), markdown: '系统浏览器真实提交' })
  }).then(async response => ({ status: response.status, author: (await response.json()).author }))`);
  assert.deepEqual(written, { status: 201, author: 'ai' });

  // 模拟运行期间导入本站用户登录，下一次受控读取仍要恢复系统身份。
  const [name, value] = cookie.split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  assert.equal(await actor(), 'user');
  await transport.snapshot(signal());
  assert.equal(await actor(), 'system');
  app.state.devices.revoke(internalDevice.id, app.clock.now().toISOString());
  await transport.snapshot(signal());
  assert.equal(await actor(), '401');
  const stored = await page.send('Storage.getCookies') as { cookies: { name: string; value: string }[] };
  assert.equal(stored.cookies.find((entry) => entry.name === 'external_login')?.value, 'external-test');
  assert.equal(stored.cookies.some((entry) => entry.name === 'plasticine_session'), false);
});
