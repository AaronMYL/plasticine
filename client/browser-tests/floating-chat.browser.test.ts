// 同一浮窗在全部内部页面覆盖显示；展开、收起和调整大小不改变底层阅读区。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser, type Cdp } from '../../scripts/browser/cdp.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const READY_MS = 45_000;
const MOTION_MS = 300;

async function until(page: Cdp, expression: string): Promise<void> {
  const deadline = Date.now() + READY_MS;
  while (!await page.evaluate<boolean>(expression)) {
    if (Date.now() > deadline) throw new Error(`等不到浮窗验收页面：${expression}`);
    await pause(40);
  }
}

interface Geometry {
  x: number;
  width: number;
  titleX: number;
  scrollTop: number;
}

async function geometry(page: Cdp): Promise<Geometry> {
  return page.evaluate<Geometry>(`(() => {
    const main = document.querySelector('.shell-main');
    const content = main.querySelector('.page') ?? main.firstElementChild;
    const title = content.querySelector('h1') ?? content;
    const box = content.getBoundingClientRect();
    return { x: box.x, width: box.width, titleX: title.getBoundingClientRect().x, scrollTop: main.scrollTop };
  })()`);
}

test('首页、信息流、图书和笔记展开收起及缩放对话都不挤压底层页面', async (t) => {
  const vite = await createServer({ root: CLIENT_ROOT, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await vite.close(); });
  for (const route of ['today', 'feed', 'books', 'notes']) {
    const page = await browser.page(`http://127.0.0.1:${address.port}/#/${route}`, 'mac', { isolated: true });
    await until(page, `document.querySelector('.shell-main h1') !== null
      && document.querySelector('.chat-collapse') !== null`);
    await pause(MOTION_MS);
    await page.evaluate(`document.querySelector('.chat-collapse').click()`);
    await until(page, `document.querySelector('.chat-dialog') === null && document.querySelector('.chat-ball') !== null`);
    const closed = await geometry(page);
    await page.evaluate(`document.querySelector('.chat-ball').click()`);
    await until(page, `document.querySelector('.chat-dialog') !== null`);
    await pause(MOTION_MS);
    assert.deepEqual(await geometry(page), closed, `${route} 展开后正文宽度、位置和滚动不变`);
    await page.evaluate(`document.querySelector('.chat-grip-nw').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    assert.deepEqual(await geometry(page), closed, `${route} 调宽浮窗后正文不重排`);
    await page.evaluate(`document.querySelector('.chat-collapse').click()`);
    await until(page, `document.querySelector('.chat-dialog') === null`);
    assert.deepEqual(await geometry(page), closed, `${route} 再次收起保持阅读位置`);
  }
});
