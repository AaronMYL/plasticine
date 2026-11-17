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
  /** 对话框的左、右边缘和上下；收起时是 null。 */
  dialog: { left: number; right: number; top: number; bottom: number } | null;
  scrollTop: number;
  /** 整个窗口有没有被撑出横向滚动。 */
  overflow: boolean;
}

async function geometry(page: Cdp): Promise<Geometry> {
  return page.evaluate<Geometry>(`(() => {
    const main = document.querySelector('.shell-main');
    const dialog = document.querySelector('.chat-dialog')?.getBoundingClientRect() ?? null;
    return { mainRight: Math.round(main.getBoundingClientRect().right),
      dialog: dialog === null ? null : { left: Math.round(dialog.left), right: Math.round(dialog.right),
        top: Math.round(dialog.top), bottom: Math.round(dialog.bottom) },
      scrollTop: main.scrollTop, overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
}

// 第13批（11-14 Aaron 看过设计稿，取代 11-12 的停靠）：电脑上展开的对话浮在页面右侧，上、下、右各留 8、整高；
// 打开、收起都不动页面布局（chat-dialog.tsx 文件头）。拖左边（或在左边的拖条上按方向键）调宽。
test('首页、信息流、图书和笔记：对话浮在右侧整高，打开收起都不动页面，调宽也不撑出横向滚动', async (t) => {
  const vite = await createServer({ root: CLIENT_ROOT, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await vite.close();
  });
  for (const route of ['today', 'feed', 'books', 'notes']) {
    const page = await browser.page(`http://127.0.0.1:${address.port}/#/${route}`, 'mac', { isolated: true });
    // 信息流那一页没有 h1（标题在第二栏里）：等主区里有了内容就行。
    await until(page, `(document.querySelector('.shell-main .page-enter')?.childElementCount ?? 0) > 0
      && (document.querySelector('.chat-collapse') !== null || document.querySelector('.chat-ball') !== null)`);
    if (await page.evaluate<boolean>(`document.querySelector('.chat-dialog') === null`)) {
      await page.evaluate(`document.querySelector('.chat-ball').click()`);
      await until(page, `document.querySelector('.chat-dialog') !== null`);
    }
    await pause(MOTION_MS);
    const open = await geometry(page);
    const height = await page.evaluate<number>('innerHeight');
    const width = await page.evaluate<number>('innerWidth');
    assert.ok(open.dialog !== null, `${route} 对话框开着`);
    assert.equal(width - open.dialog.right, 8, `${route} 右边留 8`);
    assert.ok(open.dialog.bottom <= height && height - open.dialog.bottom <= 8, `${route} 贴着下边`);
    assert.equal(open.overflow, false, `${route} 没有撑出横向滚动`);
    await page.evaluate(`document.querySelector('.chat-collapse').click()`);
    await until(page,
      `document.querySelector('.chat-dialog') === null && document.querySelector('.chat-ball') !== null`);
    const closed = await geometry(page);
    assert.equal(closed.mainRight, open.mainRight, `${route} 收起不动页面布局`);
    assert.equal(closed.scrollTop, open.scrollTop, `${route} 收起不动阅读位置`);
    await page.evaluate(`document.querySelector('.chat-ball').click()`);
    await until(page, `document.querySelector('.chat-dialog') !== null`);
    await pause(MOTION_MS);
    const again = await geometry(page);
    assert.equal(again.mainRight, closed.mainRight, `${route} 打开不动页面布局`);
    await page.evaluate(`document.querySelector('.chat-grip-w').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
    await pause(MOTION_MS);
    const wider = await geometry(page);
    assert.ok(wider.dialog !== null && again.dialog !== null && wider.dialog.left < again.dialog.left,
      `${route} 方向键把对话框调宽了`);
    assert.equal(wider.overflow, false, `${route} 调宽后没有撑出横向滚动`);
  }
});
