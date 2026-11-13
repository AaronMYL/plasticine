import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'vite';
import { launchBrowser, type Cdp } from '../../scripts/browser/cdp.ts';
import { pair, startTestApp, type TestApp } from '../../agent/tests/app/helpers.ts';

const SIZES = [[1440, 900], [768, 1024], [390, 844], [500, 500]] as const;
// 设置是一页（第 2 批）：分类在左栏，内容在右边。
const SETTINGS = `document.querySelector('.settings-dialog')`;
const SIDEBAR = `document.querySelector('.rail')`;

async function until(done: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (!await done()) {
    if (Date.now() > deadline) { throw new Error(`用户路径验收等待失败：${label}`); }
    await pause(25);
  }
}

function button(label: string, scope = 'document'): string {
  return `Array.from(${scope}.querySelectorAll('button'))
    .find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === ${JSON.stringify(label)})`;
}

async function click(page: Cdp, label: string, scope = 'document'): Promise<void> {
  const target = button(label, scope);
  await until(() => page.evaluate(`Boolean(${scope}) && Boolean(${target}) && !${target}.disabled`), label);
  await page.evaluate(`${target}.click()`);
}

async function fill(page: Cdp, selector: string, value: string): Promise<void> {
  await until(() => page.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), selector);
  await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function key(page: Cdp, value: string): Promise<void> {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value,
    windowsVirtualKeyCode: value === 'Tab' ? 9 : 13,
    ...(value === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value,
    windowsVirtualKeyCode: value === 'Tab' ? 9 : 13 });
}

async function targetFocused(page: Cdp, id: string): Promise<void> {
  await until(() => page.evaluate(`document.activeElement?.id === ${JSON.stringify(id)}`), `定位 ${id}`);
  assert.equal(await page.evaluate(`document.getElementById(${JSON.stringify(id)}).dataset.targetHighlight`), 'true');
}

async function capture(page: Cdp, prefix: string, selector: string): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  for (const [width, height] of SIZES) {
    for (const theme of ['light', 'dark']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      await until(() => page.evaluate(`Array.from(document.querySelectorAll('.sheet')).every(sheet =>
        getComputedStyle(sheet).opacity === '1' && sheet.getAnimations().every(animation =>
          animation.playState === 'finished' || animation.playState === 'idle'))`), '浮层动画结束');
      if (prefix.startsWith('search-')) {
        await page.evaluate(`document.querySelector('.palette-list')?.scrollTo(0, 0)`);
      }
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center' })`);
      await pause(90);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false,
        `${prefix} ${width} ${theme} 页面不横向溢出`);
      assert.equal(await page.evaluate(`(() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return box.left >= -1 && box.right <= innerWidth + 1 && box.width > 0;
      })()`), true, `${prefix} ${width} ${theme} 目标可见`);
      // 不完整的控件逐个列出来（名字、左右边、内容宽 / 可见宽）。
      assert.deepEqual(await page.evaluate(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        const bounds = target.getBoundingClientRect();
        // 横向滑动的一行（如查找的内容类型）里滑出窗口的那几个不算：滑过去就看得见、点得到。
        const scrolled = control => {
          for (let node = control.parentElement; node && node !== target.parentElement; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowX;
            if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth + 1) return true;
          }
          return false;
        };
        return Array.from(target.querySelectorAll('button, input, select, textarea, a[href]')).filter(control => {
          if (scrolled(control)) return false;
          const box = control.getBoundingClientRect();
          return !(box.width === 0 || (box.left >= Math.max(0, bounds.left) - 1
            && box.right <= Math.min(innerWidth, bounds.right) + 1
            && (!control.matches('button, a[href]') || control.scrollWidth <= control.clientWidth + 1)));
        }).map(control => (control.getAttribute('aria-label') || control.textContent.trim()).slice(0, 40) + ' '
          + Math.round(control.getBoundingClientRect().left) + '..' + Math.round(control.getBoundingClientRect().right)
          + ' ' + control.scrollWidth + '/' + control.clientWidth);
      })()`), [], `${prefix} ${width} ${theme} 行内控件完整可操作`);
      if (directory !== undefined) {
        await mkdir(directory, { recursive: true });
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(join(directory, `${prefix}-${width}-${theme}.png`),
          Buffer.from(String(shot['data']), 'base64'));
      }
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await page.evaluate(`document.documentElement.dataset.theme = 'light'`);
}

function searchFixtures(app: TestApp) {
  const note = app.state.notes.create({ folder: '笔记', author: 'user',
    markdown: '# 旅行准备\n\n' + '先把已确定的资料留在原处。\n\n'.repeat(100) + '远足集合细节：带上路线和回程车次。' });
  for (let index = 0; index < 31; index += 1) {
    app.state.notes.create({ folder: '笔记', author: 'user', markdown: `# 分页查找资料 ${index + 1}\n\n正文 ${index + 1}` });
  }
  // 记忆 11-03 起是按主题整理的活文档，查找只查它（不查旧的 memory_entries）。
  const topic = app.state.memoryDocs.docs.create({ kind: 'topic', title: '出行', summary: '', createdBy: 'brain' });
  app.state.memoryDocs.lines.add({ docId: topic.id, text: '远足时先确认回程交通', basis: 'stated', writtenBy: 'user',
    anchors: [{ kind: 'user_edit', ref: 'ui-search-memory' }] });
  const source = app.state.feedSources.create({ kind: 'interest', label: '出行资料' });
  const feed = app.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '远足路线的旧信息',
    summary: '保存之前核对路线，再决定集合地点。', day: '2026-10-01',
    arrivedAt: '2026-10-01T02:00:00.000Z', dedupeKey: 'ui-search-old-feed' }).item;
  const privateNote = app.state.notes.create({ folder: '笔记', author: 'user',
    markdown: '# 远足私密内容\n\n私密行程正文可以直接阅读。', private: true });
  return { note, privateNote, feed, topic };
}

/** ⌘K 浮层（11-12 起查找和切换是同一个浮层，入口在左边图标栏）：填词，等结果出来。 */
async function openPalette(page: Cdp, text: string): Promise<void> {
  if (!await page.evaluate(`Boolean(document.querySelector('.palette-input'))`)) {
    await click(page, '搜索和切换', `document.querySelector('.rail')`);
  }
  await fill(page, '.palette-input', text);
  await until(() => page.evaluate(`document.querySelectorAll('.palette-row').length > 1`), `「${text}」的结果`);
}

/** 浮层里标题是这一句的那一行（第几组由 group 定），点了打开。 */
const paletteRow = (title: string): string => `Array.from(document.querySelectorAll('.palette-row'))
  .find(row => row.querySelector('.palette-title')?.textContent === ${JSON.stringify(title)})`;

async function choose(page: Cdp, title: string): Promise<void> {
  await until(() => page.evaluate(`(() => { const row = ${paletteRow(title)}; row?.click(); return row !== undefined; })()`),
    `打开「${title}」`);
}

async function verifySearch(page: Cdp, app: TestApp, fixtures: ReturnType<typeof searchFixtures>): Promise<void> {
  const { note, privateNote, feed, topic } = fixtures;
  await openPalette(page, '远足');
  await until(() => page.evaluate(`Boolean(${paletteRow('旅行准备')})`), '正文深处命中的笔记');
  assert.equal(await page.evaluate(`Boolean(${paletteRow('远足私密内容')})`), true, '登录后同样查到自己的私密笔记');
  await capture(page, 'search-all-content', '.palette');
  await choose(page, '远足私密内容');
  await until(() => page.evaluate(`location.hash === ${JSON.stringify(`#/notes/${privateNote.id}`)}
    && document.querySelector('.note-pane .ProseMirror')?.textContent.includes('私密行程正文可以直接阅读')`),
  '私密查找结果直接打开正文');
  assert.equal(await page.evaluate(`document.querySelector('.note-pane').textContent.includes('确认解锁')`), false);
  await openPalette(page, '远足');
  await choose(page, '旅行准备');
  await until(() => page.evaluate(`location.hash === ${JSON.stringify(`#/notes/${note.id}`)}
    && document.querySelector('.note-pane')?.textContent.includes('远足集合细节')`), '笔记正文深处命中后直达');
  await openPalette(page, '远足');
  await choose(page, '远足路线的旧信息');
  await targetFocused(page, `feed-target-${feed.id}`);
  assert.equal(await page.evaluate(`location.hash`), `#/feed/${feed.id}`);
  await openPalette(page, '回程交通');
  await choose(page, topic.title);
  await until(() => page.evaluate(`location.hash === ${JSON.stringify(`#/memory/topics/${topic.id}`)}`), '记忆直达');
  // 浮层每组最多列 GROUP_MAX 条，最后一行是「让 Plasticine 做」；服务端照样查得到全部。
  await openPalette(page, '分页查找');
  assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('.palette-row .palette-title'))
    .filter(node => node.textContent.startsWith('分页查找资料')).length`), 4);
  assert.equal(app.state.search.query({ q: '分页查找' }).total, 31);
  await capture(page, 'search-grouped-results', '.palette');
  // 截图换过深浅色、滚过列表，焦点可能不在浮层里；Esc 从输入框发出。
  await page.evaluate(`document.querySelector('.palette-input')?.focus()`);
  await key(page, 'Escape');
  await until(() => page.evaluate(`!document.querySelector('.palette')`), 'Esc 收起浮层');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK',
    windowsVirtualKeyCode: 75, modifiers: 4 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK',
    windowsVirtualKeyCode: 75, modifiers: 4 });
  await until(() => page.evaluate(`document.activeElement?.classList.contains('palette-input') === true`),
    '⌘K 打开并聚焦');
  await key(page, 'Escape');
}

test('普通用户完整路径：设置通用的时区、信息流单条直达与返回、⌘K 直达笔记 / 信息流 / 记忆', async (t) => {
  const app = await startTestApp(['本地验收的固定回复。'], { startTasks: false });
  t.after(async () => { await app.close(); });
  const fixtures = searchFixtures(app);
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const source = app.state.feedSources.create({ kind: 'interest', label: '学习与工作方法' });
  const item = app.state.feedItems.add({ sourceId: source.id, origin: 'feed', title: '把零散资料整理成可继续的线索',
    summary: '先保留原始资料，再写下一步要核对的问题。重新回来时，可以从同一条内容继续阅读和讨论。',
    why: '与你正在整理资料的关切有关。', day, arrivedAt: `${day}T02:00:00.000Z`,
    dedupeKey: 'ui-review-target' }).item;
  app.state.feedItems.update(item.id, item.version, { reaction: 'dislike' });
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
    server: { hmr: false, host: '127.0.0.1', port: 0, proxy: { '/v2': { target: app.base } } } });
  await vite.listen();
  t.after(async () => { await vite.close(); });
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const browser = await launchBrowser();
  t.after(async () => { await browser.close(); });
  const page = await browser.page(`${base}/browser-tests/fixtures/feed.html#/today`);
  const [name, value] = (await pair(app)).split('=');
  assert.equal((await page.send('Network.setCookie', { name, value, url: base }))['success'], true);
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await page.send('Page.reload');
  // 11-13 设置六段：时区在「通用」里；从地址打开设置（头像按钮的名字跟着账号走）。
  await page.evaluate(`location.hash = '#/settings'`);
  await until(() => page.evaluate(`Boolean(${SETTINGS})`), '设置弹框');
  await click(page, '通用', SETTINGS);
  await click(page, '选择时区', SETTINGS);
  await fill(page, '.settings-time-zone input[type="search"]', '北京');
  const zoneButton = `Array.from(document.querySelectorAll('[aria-label="可选时区"] button'))
    .find(button => button.textContent.includes('Asia/Shanghai'))`;
  await until(() => page.evaluate(`Boolean(${zoneButton})`), '城市搜索');
  await page.evaluate(`${zoneButton}.click()`);
  assert.equal(await page.evaluate(`document.querySelector('[aria-label="所选时区的当前时间"]')
    .textContent.includes('UTC+08:00')`), true);
  await capture(page, 'settings-time-zone', '.settings-time-zone');
  await click(page, '保存', SETTINGS);
  await until(() => app.state.dailySettings.read().settings.timeZone === 'Asia/Shanghai', '真实HTTP保存时区');
  await click(page, '关掉设置', SETTINGS);
  await page.evaluate(`location.hash = ${JSON.stringify(`#/feed/${encodeURIComponent(item.id)}`)}`);
  await targetFocused(page, `feed-target-${item.id}`);
  // 信息流是卡片（role=listitem），直达页只摆这一张。
  const card = `document.querySelector('[aria-label="直达的信息"] [role="listitem"]')`;
  assert.equal(await page.evaluate(`document.querySelectorAll('[aria-label="直达的信息"] [role="listitem"]').length`), 1);
  await click(page, '收藏', card);
  await until(() => page.evaluate(`Boolean(${button('已收藏', card)})`), '单条收藏回执');
  await capture(page, 'feed-direct-item', '[aria-label="直达的信息"]');
  await click(page, '返回信息流');
  await until(() => page.evaluate(`location.hash === '#/feed' && Boolean(document.querySelector('.feed-board'))`),
    '返回列表');
  await verifySearch(page, app, fixtures);
});
