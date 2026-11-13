// 工具和系统在真服务端上走一遍（2026-11-05 删掉任务、自迭代、日历和提醒之后剩下的）：
//   文件：磁盘上别处改了不覆盖，先看新版再决定；记账：改一笔、加账户；
//   设置：外观只在这台设备记住、刷新保持；系统 · 设备领配对码、撤销另一台（先说后果）；手机底栏下滚收起；
//   主区一页出错不挡对话框；浏览器地址栏把非网址转成搜索、⋯ 里清登录和关所有标签页；
//   引用的约定（词语）由已配对本人确认生效再撤回；退出这台后用配对码回来，会话读不到时可重新连接。

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import type { Plugin } from 'vite';
import { pair, TEST_PASSWORD } from '../../agent/tests/app/helpers.ts';
import type { BrowserTransport } from '../../agent/src/cloud-tools/index.ts';
import { locateShotElement, selectorPreflight } from '../../scripts/browser/shot-page.ts';
import type { Cdp } from '../../scripts/browser/cdp.ts';
import { click, fill, layouts, settle, size, startStack, text, until } from './helpers.ts';
import { reloadPage } from './reload.ts';

const SETTINGS = `document.querySelector('.settings-dialog')`;

async function tool(page: Cdp, hash: string, name: string): Promise<void> {
  await page.evaluate(`location.hash = ${JSON.stringify(hash)}`);
  await until(page, `document.querySelector('.shell-main h1')?.textContent.trim() === ${JSON.stringify(name)}`, name);
}

async function select(page: Cdp, selector: string, value: string): Promise<void> {
  await until(page, `document.querySelector(${JSON.stringify(selector)})`, selector);
  await page.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('change', { bubbles: true })); })()`);
}

/** 文件页渲染时按开关抛错：核对主区出错只落在主区。 */
const pageFailure: Plugin = { name: 'isolated-page-error', enforce: 'pre', transform(source, id) {
  if (!id.endsWith('/views/tools/files-view.tsx')) {
    return undefined;
  }
  const head = 'export function FilesView(): ReactNode {';
  assert.ok(source.includes(head), '文件页的函数头和注入点对得上');
  return source.replace(head, `${head} if ((globalThis as { __pageFailure?: boolean }).__pageFailure) `
    + 'throw new Error("隔离主区渲染故障");');
} };

test('工具：文件被别处改了不覆盖，核对新版后写回；记账改一笔、加一个账户', async (t) => {
  const { app, page } = await startStack(t, { realClock: true });
  const directory = join(app.directory, 'files');
  await mkdir(directory);
  await writeFile(join(directory, 'draft.txt'), '初版');
  await tool(page, '#/tools/files', '文件');
  await click(page, 'draft.txt');
  await until(page, `document.querySelector('.file-text-content')?.value === '初版'`, '读文本');
  await fill(page, '.file-text-content', '我的未存草稿');
  await writeFile(join(directory, 'draft.txt'), '磁盘新版');
  await click(page, '保存文本');
  await until(page, text('文件已在别处修改'), '冲突');
  assert.equal(await readFile(join(directory, 'draft.txt'), 'utf8'), '磁盘新版');
  await click(page, '读取磁盘新版');
  await until(page, text('磁盘上的新版'), '新版');
  await click(page, '已核对新版，继续保存我的内容');
  await click(page, '保存文本');
  await settle(async () => await readFile(join(directory, 'draft.txt'), 'utf8') === '我的未存草稿', '核对后写回');
  await fill(page, '[aria-label="文件路径"]', app.directory);
  await click(page, '前往');
  await until(page, text('plasticine.sqlite'), '前往目录');
  await layouts(page, 'tools-files', '.shell-main', false);

  await tool(page, '#/tools/money', '记账');
  await fill(page, '[aria-label="记一笔"] input[inputmode="decimal"]', '14');
  await fill(page, '[aria-label="记一笔"] input:not([inputmode])', '隔离咖啡');
  await click(page, '记下');
  await click(page, '隔离咖啡');
  await fill(page, '[aria-label="编辑这笔账"] input[inputmode="decimal"]', '15.5');
  await select(page, '[aria-label="编辑这笔账"] select', 'refund');
  await click(page, '保存这笔账');
  await until(page, text('+¥15.50'), '改好的一笔');
  await click(page, '资产');
  await click(page, '加一个账户');
  await fill(page, '[aria-label="加一个账户"] input:not([inputmode])', '浏览器钱包');
  await click(page, '保存账户');
  await until(page, text('浏览器钱包'), '新账户');
  await layouts(page, 'tools-money', '.shell-main', false);
});

test('截图定位：Chromium 真文字范围与 visibility 覆盖、合法属性选择器', async (t) => {
  const { page } = await startStack(t);
  await until(page, 'document.body !== null', '页面载入');
  await page.evaluate(`document.body.innerHTML = '<section style="height:1200px"><span style="display:block;`
    + `margin-top:1000px">远处文字</span></section>'`);
  assert.equal(await page.evaluate(locateShotElement({ text: '远处文字' })), false);
  await page.evaluate(`document.body.innerHTML = '<div style="visibility:hidden"><button text="保存" `
    + `style="visibility:visible">可见按钮</button></div>'`);
  assert.equal(await page.evaluate(locateShotElement({ text: '可见按钮' })), true);
  assert.equal(await page.evaluate(selectorPreflight(['button[text="保存"]'])), true);
  assert.equal(await page.evaluate(locateShotElement({ selector: 'button[text="保存"]' })), true);
});

test('设置：外观刷新保持；账号 · 登录着的设备，让另一台退出先说后果；手机底栏下滚收起；装到主屏幕的清单', async (t) => {
  const { app, page, base } = await startStack(t, { realClock: true });
  await pair(app, '另一台隔离浏览器');
  await page.evaluate(`location.hash = '#/settings'`);
  const appearance = `document.querySelector('[role="group"][aria-label="外观"]')`;
  await click(page, '深色', appearance);
  await until(page, `document.documentElement.dataset.theme === 'dark'`, '外观生效');
  await reloadPage(page);
  await until(page, `document.documentElement?.dataset.theme === 'dark'`, '刷新保持外观');
  // 设置的地址跟着弹框：刷新后照样开着。
  await click(page, '浅色', appearance);
  // 11-13 设置六段：登录着的设备在「账号」里；配对码 11-08 去掉了。
  await click(page, '账号', SETTINGS);
  const devices = `document.querySelector('[aria-label="登录着的设备"]')`;
  await until(page, text('另一台隔离浏览器', devices), '设备列表');
  await until(page, text('这台', devices), '这台');
  await click(page, '让「另一台隔离浏览器」退出', SETTINGS);
  await until(page, text('「另一台隔离浏览器」会退出，要用 @账号和密码重新登录。', SETTINGS), '先说后果');
  await layouts(page, 'settings-account', '.settings-dialog');
  await click(page, '确定退出', SETTINGS);
  await settle(() => app.state.devices.list().find((row) => row.name === '另一台隔离浏览器')?.revokedAt != null,
    '撤销落到服务端');
  await until(page, `!(${text('另一台隔离浏览器', devices)})`, '列表里去掉');
  await click(page, '关掉设置', SETTINGS);
  await until(page, `!${SETTINGS}`, '设置收起');
  assert.equal(await page.evaluate<boolean>(`location.hash.startsWith('#/settings')`), false, '设置不占标签');

  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1,
    mobile: true });
  await until(page, `document.querySelector('.phone-bar')`, '手机底栏');
  await page.evaluate(`document.querySelector('.shell-main').append(Object.assign(document.createElement('div'),
    { style: 'height: 2000px' }))`);
  await page.evaluate(`document.querySelector('.shell-main').scrollTop = 0`);
  await pause(30);
  await page.evaluate(`document.querySelector('.shell-main').scrollTop = 200`);
  await until(page, `document.querySelector('.phone-bar')?.dataset.hidden === 'true'`, '下滚收起底栏');
  await until(page, `document.querySelector('.phone-bar')?.dataset.hidden === 'false'`, '停下露出底栏');
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json() as { display: string; icons: unknown[] };
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length >= 2);
});

test('主区出错不挡对话；浏览器控制；本人确认约定再撤回；退出这台后用密码登录回来，会话读不到能重新连接', async (t) => {
  const opened: string[] = [];
  const tabActions: string[] = [];
  let snapshot: Awaited<ReturnType<NonNullable<BrowserTransport['snapshot']>>> = {
    tabs: [{ id: 'isolated-tab', url: 'about:blank', title: '隔离标签' }], activeTabId: 'isolated-tab' };
  const transport: BrowserTransport = {
    async open(url) {
      opened.push(url);
      snapshot = { ...snapshot, tabs: [{ id: 'isolated-tab', url, title: '隔离搜索' }] };
      return { sessionId: 'isolated-tab', url, title: '隔离搜索' };
    },
    async act() { return { sessionId: 'isolated-tab', url: 'about:blank', title: '隔离标签' }; },
    async frame() { return Buffer.from([0x89, 0x50, 0x4e, 0x47]); },
    async text() { return '隔离网页'; },
    async snapshot() { return snapshot; },
    async watch() { return { async ack() {}, async close() {} }; },
    async tab(action) {
      tabActions.push(action.kind);
      if (action.kind === 'close_all') {
        snapshot = { tabs: [{ id: 'blank-tab', url: 'about:blank', title: '' }], activeTabId: 'blank-tab' };
      }
      return snapshot;
    },
  };
  const { app, page } = await startStack(t, { realClock: true, plugins: [pageFailure],
    app: { cloudTransports: { browser: transport } } });
  const term = app.state.agreements.create({ kind: 'term', title: '浏览器词语验收', text: '原来的定义',
    scope: '隔离验收', termTier: 'exact' }, { actor: 'user', reason: '隔离验收' });

  await page.evaluate('globalThis.__pageFailure = true');
  await tool(page, '#/tools/files', '这一页出错了');
  await until(page, text('隔离主区渲染故障', '.shell-main'), '主区出错');
  assert.equal(await page.evaluate(`Boolean(document.querySelector('.rail'))`), true, '侧栏还在');
  await fill(page, 'textarea[aria-label="问一句"]', '主区出错时我仍能补充');
  assert.equal(await page.evaluate(`document.querySelector('textarea[aria-label="问一句"]').value`),
    '主区出错时我仍能补充', '对话框照常能写');
  await page.evaluate('globalThis.__pageFailure = false');
  await click(page, '再试一次');
  await until(page, `document.querySelector('.shell-main h1')?.textContent.trim() === '文件'`, '再试一次回来');

  await page.evaluate(`location.hash = '#/browser'`);
  await until(page, text('隔离标签'), '浏览器');
  await fill(page, '[aria-label="地址栏"]', '隔离搜索词');
  await page.evaluate(`document.querySelector('[aria-label="地址栏"]').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await settle(() => opened.length === 1, '非网址转成搜索');
  assert.ok(opened[0]?.includes(encodeURIComponent('隔离搜索词')));
  await click(page, '更多浏览器操作');
  await click(page, '清空登录');
  await settle(() => tabActions.includes('clear_login'), '清登录发到隔离传输');
  await click(page, '更多浏览器操作');
  await click(page, '关掉所有标签页');
  await settle(() => tabActions.includes('close_all'), '关所有标签页');

  await page.evaluate(`location.hash = ${JSON.stringify(`#/memory/terms/${term.id}`)}`);
  const focus = `document.querySelector('[aria-label="引用的条目"]')`;
  await until(page, `Array.from((${focus})?.querySelectorAll('button') ?? [])
    .some((node) => node.textContent.trim() === '确认生效' && !node.disabled)`, '已配对会话可以确认');
  await click(page, '确认生效', focus);
  await settle(() => app.state.agreements.require(term.id).state === 'active', '约定生效');
  await until(page, text('第 2 版', focus), '读回生效后的那一版');
  // 撤回在行尾 ⋯ 里；点了先常显后果，再点「撤回」确认。
  await click(page, '「浏览器词语验收」的更多操作', focus);
  await click(page, '撤回', `document.querySelector('[role="menu"]')`);
  await until(page, text('撤了它就不再按这条办', focus), '撤的后果');
  await click(page, '撤回', `(${focus}).querySelector('[aria-label="确认撤掉"]')`);
  await settle(() => app.state.agreements.require(term.id).state === 'revoked', '撤回约定');

  // 11-08 起没有配对码：退出这台以后用密码登录回来（startStack 用 pair(app) 登录的这台叫「测试手机」）。
  await page.evaluate(`location.hash = '#/settings/account'`);
  await click(page, '退出这台', SETTINGS);
  await until(page, text('退出后要用 @账号和密码重新登录。', SETTINGS), '先说后果');
  await click(page, '确定退出', SETTINGS);
  await until(page, `document.querySelector('main.login')`, '回到登录页');
  await fill(page, '#login-password', TEST_PASSWORD);
  await click(page, '登录');
  await until(page, `document.querySelector('.shell-main')`, '登录后回到应用');
  await page.send('Page.enable');
  const script = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const original = window.fetch; let cut = true; window.fetch = (...args) => {
      if (cut && String(args[0]).endsWith('/v2/session')) { cut = false; return Promise.reject(new Error('隔离断线')); }
      return original(...args); }; })();` });
  await reloadPage(page);
  await until(page, text('重新连接'), '会话读不到');
  await click(page, '重新连接');
  await until(page, `document.querySelector('.shell-main')`, '重新连接回来');
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script['identifier'] });
  await size(page, 1440, 900);
});
