import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpBrowser } from '../../agent/src/cloud-tools/cdp-browser.ts';
import { startStack, until } from './helpers.ts';

test('Self-visit skips pairing, real cookie covers login; revoke removes site cookie', async (t) => {
  const { app, page, browser, base, cookie } = await startStack(t, { hash: '/notes', client: 'mac' });
  await until(page, 'document.querySelector(".shell-main") !== null', '已经配对的个人页面');
  const sessions = app.app.deps.browserSessions;
  const transport = new CdpBrowser({ endpoint: browser.endpoint, internalUrl: base,
    internalCookies: () => sessions.cookies(base) });
  t.after(() => transport.close());
  const signal = () => AbortSignal.timeout(15_000);
  const ask = () => page.evaluate<string>(`fetch('/v2/session').then(async response =>
    response.ok ? (await response.json()).actor ?? 'user' : String(response.status))`);
  const actor = async (): Promise<string> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await ask();
      } catch (error) {
        if (attempt === 3 || !(error instanceof Error) || !error.message.includes('navigated or closed')) throw error;
        await until(page, 'document.readyState === "complete"', '换页之后');
      }
    }
  };
  assert.equal(await actor(), 'user');
  await page.send('Network.setCookie', { name: 'external_login', value: 'external-test',
    url: 'https://external.test/', httpOnly: true, secure: true });
  await transport.snapshot(signal());
  assert.equal(await actor(), 'system');
  await page.send('Page.reload');
  await until(page, 'document.querySelector(".shell-main") !== null', '系统浏览器直接打开内部页面');
  assert.equal(await actor(), 'system');
  const internalDevice = sessions.open().device;
  const written = await page.evaluate<{ status: number; author: string }>(`fetch('/v2/notes', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), markdown: '系统浏览器真实提交' })
  }).then(async response => ({ status: response.status, author: (await response.json()).author }))`);
  assert.deepEqual(written, { status: 201, author: 'ai' });

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
