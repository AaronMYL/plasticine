// 装成客户端的验收底座本身（scripts/browser/as-client.ts、fake-native.ts）：电脑按有鼠标、手机按触屏，客户端
// User-Agent 和模拟的原生桥都在网页第一行脚本之前装好；网页调桥按共享协议核对。2026-11-05 起网页是正式端（不再拦
// 「请用客户端」），手机只用网页：底栏只有首页 · 消息 · 笔记 · 信息流；项目、记忆承接只读详情，其余对象保留地址。
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser, type Cdp } from '../../scripts/browser/cdp.ts';
import { checkNativeCalls, nativeCalls } from '../../scripts/browser/fake-native.ts';

const CLIENT_ROOT = fileURLToPath(new URL('..', import.meta.url));
// 第一次打开开发服务器要现做依赖预构建，两核机器上会过十几秒。
const WAIT_MS = 45_000;

async function until(page: Cdp, expression: string, label: string): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (!await page.evaluate<boolean>(expression)) {
    if (Date.now() > end) {
      const seen = await page.evaluate<string>(`location.href + ' ' + document.body.innerText.slice(0, 300)`);
      throw new Error(`等不到：${label}（页面：${seen}）`);
    }
    await pause(50);
  }
}

async function click(page: Cdp, selector: string): Promise<void> {
  const target = `document.querySelector(${JSON.stringify(selector)})`;
  await until(page, `${target} !== null`, selector);
  await page.evaluate(`${target}.click()`);
}

async function evidence(page: Cdp, name: string): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory === undefined) {
    return;
  }
  await mkdir(directory, { recursive: true });
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(String(shot['data']), 'base64'));
}

async function devServer(): Promise<{ base: string; close(): Promise<void> }> {
  const vite = await createServer({ root: CLIENT_ROOT, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  return { base: `http://127.0.0.1:${address.port}`, close: () => vite.close() };
}

const MEDIA = `JSON.stringify({ hover: matchMedia('(hover: hover)').matches,
  coarse: matchMedia('(pointer: coarse)').matches, ua: navigator.userAgent,
  mac: window.plasticineDesktop !== undefined, ios: window.plasticineIOS !== undefined })`;

interface Media { hover: boolean; coarse: boolean; ua: string; mac: boolean; ios: boolean }

async function media(page: Cdp): Promise<Media> {
  return JSON.parse(await page.evaluate<string>(MEDIA)) as Media;
}

test('装成 Mac：有鼠标、PlasticineMac 标记和桥，网页标签同步、⋯ 菜单、圈一块都按桥协议往来', async (t) => {
  const server = await devServer();
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const page = await browser.page(`${server.base}/#/today`, 'mac', { isolated: true });
  await until(page, `document.querySelector('.shell-main') !== null`, '主栏');
  const facts = await media(page);
  assert.equal(facts.hover, true, '电脑按有鼠标');
  assert.equal(facts.coarse, false);
  assert.match(facts.ua, /PlasticineMac\/[0-9.]+$/);
  assert.deepEqual([facts.mac, facts.ios], [true, false]);
  await until(page, `window.__plasticineFakeNative.calls.some((call) => call.method === 'titlebar')`, '顶栏布局');
  await click(page, '[aria-label="本地优先软件的同步难题"]');
  await until(page, `window.__plasticineFakeNative.calls.some((call) => call.method === 'sync'
    && call.args[0].active !== null && call.args[0].frame !== null)`, '网页标签垫到中间区');
  await click(page, '.shell-main [aria-label="更多"]');
  await until(page, `document.querySelector('.web-menu')?.textContent.includes('下载') === true`, 'Mac 的 ⋯ 有下载');
  await evidence(page, 'client-mac-web-menu');
  await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await page.evaluate('window.__plasticineFakeNative.circleAnswers = true');
  await click(page, '.shell-main [aria-label="圈一块"]');
  await until(page, `document.body.textContent.includes('摘要 · ')`, '圈好的一块进了对话框引用');
  await evidence(page, 'client-mac-circle');
  const calls = await checkNativeCalls(page);
  const tools = calls.filter((call) => call.method === 'tool').map((call) => (call.args[1] as { kind: string }).kind);
  assert.ok(tools.includes('circle'), `调过圈一块：${tools.join('、')}`);
});

test('手机网页：触屏、没有桥、四项底栏；项目和记忆只读承接，不支持的页保留完整地址', async (t) => {
  const server = await devServer();
  const browser = await launchBrowser();
  t.after(async () => {
    await browser.close();
    await server.close();
  });
  const page = await browser.page(`${server.base}/#/today`, 'phone', { isolated: true });
  await until(page, `document.querySelector('.shell-main') !== null`, '主栏');
  const facts = await media(page);
  assert.equal(facts.hover, false, '手机没有悬停');
  assert.equal(facts.coarse, true);
  assert.doesNotMatch(facts.ua, /Plasticine(Mac|IOS)\//);
  assert.deepEqual([facts.mac, facts.ios], [false, false]);
  assert.equal(await page.evaluate('innerWidth'), 390);
  await until(page, `document.querySelector('nav.phone-bar') !== null`, '底栏');
  assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('nav.phone-bar .phone-tab'))
    .map((tab) => tab.textContent.trim())`), ['首页', '消息', '笔记', '信息流']);
  await click(page, 'nav.phone-bar .phone-tab:nth-child(3)');
  await until(page, `location.hash.startsWith('#/notes')`, '点「笔记」到笔记');
  await page.evaluate(`location.hash = '#/projects'`);
  await until(page, `document.querySelector('.phone-read-unavailable')?.textContent === '项目暂时不能在手机打开。'`,
    '项目总览说明手机边界，不跳回首页');
  assert.equal(await page.evaluate('location.hash'), '#/projects');

  await page.evaluate(`location.hash = '#/projects/project_hunter'`);
  await until(page, `document.querySelector('.phone-read-title h1')?.textContent === 'Cyber Hunter'
    && document.querySelector('.phone-read-section[aria-label="待办"]') !== null`, '具体项目正文可读');
  assert.equal(await page.evaluate('location.hash'), '#/projects/project_hunter');
  assert.equal(await page.evaluate(`document.querySelector('.phone-read-title .tag')?.textContent`), '只读');
  assert.equal(await page.evaluate(`document.querySelector('.phone-content input, .phone-content textarea,'
    + ' .phone-content [contenteditable="true"]') === null`), true, '项目详情不露编辑控件');
  await evidence(page, 'client-phone-project');

  await page.evaluate(`location.hash = '#/memory/topics/memdoc-rules'`);
  await until(page, `document.querySelector('.phone-read-title h1')?.textContent === '怎么替你做事'
    && document.querySelector('.phone-content')?.textContent.includes('改设计先出电脑和手机截图')`, '记忆主题原文可读');
  assert.equal(await page.evaluate('location.hash'), '#/memory/topics/memdoc-rules');
  assert.equal(await page.evaluate(`document.querySelector('.phone-read-title .tag')?.textContent`), '只读');
  assert.equal(await page.evaluate(`document.querySelector('.phone-content input, .phone-content textarea,'
    + ' .phone-content [contenteditable="true"]') === null`), true, '记忆主题不露编辑控件');
  await evidence(page, 'client-phone-memory');

  await page.evaluate(`location.hash = '#/books/book_1/2/40'`);
  await until(page, `document.querySelector('.phone-read-unavailable')?.textContent === '图书暂时不能在手机打开。'`,
    '不支持的图书详情保留对象、章节和位置');
  assert.equal(await page.evaluate('location.hash'), '#/books/book_1/2/40');
  assert.equal(await page.evaluate(`document.querySelector('.phone-content-actions button')?.textContent`),
    '复制链接到电脑', '给出可接着使用原地址的操作');
  await evidence(page, 'client-phone-unsupported-book');
  const calls = await checkNativeCalls(page);
  assert.deepEqual(calls, [], '手机网页不调原生桥');
});

test('网页调桥不合协议时验收失败：关浏览器前逐条核对', async (t) => {
  const server = await devServer();
  const browser = await launchBrowser();
  let closed = false;
  t.after(async () => {
    if (!closed) {
      await browser.close().catch(() => undefined);
    }
    await server.close();
  });
  const page = await browser.page(`${server.base}/#/today`, 'mac', { isolated: true });
  await until(page, `window.plasticineDesktop !== undefined`, '桥');
  await page.evaluate(`window.plasticineDesktop.webTabs.command('t1', 'teleport')`);
  assert.equal((await nativeCalls(page)).length > 0, true);
  closed = true;
  await assert.rejects(browser.close(), /plasticineTabs\.command/);
});
