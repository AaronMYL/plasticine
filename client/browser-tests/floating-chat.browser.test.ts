// 宽窗口上对话停靠成右边一栏：在全部内部页面上都不盖页面；收起、展开、调宽后页面跟着让位。
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
  /** 主区（页面那一块）的右边缘。 */
  mainRight: number;
  /** 对话栏的左边缘；收起时是 null。 */
  dockLeft: number | null;
  docked: boolean;
  scrollTop: number;
  /** 整个窗口有没有被撑出横向滚动。 */
  overflow: boolean;
}

async function geometry(page: Cdp): Promise<Geometry> {
  return page.evaluate<Geometry>(`(() => {
    const main = document.querySelector('.shell-main');
    const dialog = document.querySelector('.chat-dialog');
    return { mainRight: Math.round(main.getBoundingClientRect().right),
      dockLeft: dialog === null ? null : Math.round(dialog.getBoundingClientRect().left),
      docked: dialog?.getAttribute('data-docked') === 'true', scrollTop: main.scrollTop,
      overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
}

// 11-12 全量优化（Aaron 定「对话栏停靠」，推翻 11-03 的「浮窗不挤压页面」）：1440 宽时展开的对话是右边一栏，页面让出位置。
test('首页、信息流、图书和笔记：对话停靠在右边不盖页面，收起后页面用回整宽，调宽也不盖', async (t) => {
  const vite = await createServer({ root: CLIENT_ROOT, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); await vite.close(); });
  for (const route of ['today', 'feed', 'books', 'notes']) {
    const page = await browser.page(`http://127.0.0.1:${address.port}/#/${route}`, 'mac', { isolated: true });
    // 信息流那一页没有 h1（标题在第二栏里）：等主区里有了内容就行。
    await until(page, `(document.querySelector('.shell-main .page-enter')?.childElementCount ?? 0) > 0
      && document.querySelector('.chat-collapse') !== null`);
    await pause(MOTION_MS);
    const open = await geometry(page);
    assert.equal(open.docked, true, `${route} 宽窗口上对话是停靠的`);
    assert.ok(open.dockLeft !== null && open.mainRight <= open.dockLeft, `${route} 页面没有被对话栏盖住`);
    assert.equal(open.overflow, false, `${route} 没有撑出横向滚动`);
    await page.evaluate(`document.querySelector('.chat-collapse').click()`);
    await until(page,
      `document.querySelector('.chat-dialog') === null && document.querySelector('.chat-ball') !== null`);
    const closed = await geometry(page);
    assert.ok(closed.mainRight > open.mainRight, `${route} 收起后页面用回整宽`);
    assert.equal(closed.scrollTop, open.scrollTop, `${route} 收起不动阅读位置`);
    await page.evaluate(`document.querySelector('.chat-ball').click()`);
    await until(page, `document.querySelector('.chat-dialog') !== null`);
    await pause(MOTION_MS);
    await page.evaluate(`document.querySelector('.chat-grip-w').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    await pause(MOTION_MS);
    const wider = await geometry(page);
    assert.ok(wider.dockLeft !== null && wider.dockLeft < (open.dockLeft ?? 0), `${route} 方向键把对话栏调宽了`);
    assert.ok(wider.mainRight <= wider.dockLeft, `${route} 调宽后页面仍然没有被盖住`);
    assert.equal(wider.overflow, false, `${route} 调宽后没有撑出横向滚动`);
  }
});
