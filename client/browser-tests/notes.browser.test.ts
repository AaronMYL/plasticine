import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer, type ViteDevServer } from 'vite';
import { launchBrowser, type Cdp, type LocalBrowser } from '../../scripts/browser/cdp.ts';
import { pair, startTestApp, type TestApp } from '../../agent/tests/app/helpers.ts';
import type { TextStep } from '../../agent/tests/brain/helpers.ts';
import { reloadPage } from './reload.ts';

const EDITOR = `document.querySelector('.note-body .ProseMirror').editor`;
let current: Cdp | undefined;
async function until(done: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (!await done()) {
    if (Date.now() > deadline) {
      const body = await current?.evaluate<string>(
        `(document.querySelector('.shell-main')?.innerText ?? '') + JSON.stringify(window.noteConsoleErrors ?? [])`,
      ).catch(() => '');
      throw new Error(`笔记浏览器等待失败：${label}；主区：${body}`);
    }
    await pause(25);
  }
}
async function click(page: Cdp, text: string, scope = 'document'): Promise<void> {
  const selector = `Array.from(${scope}.querySelectorAll('button'))
    .find(b => b.getClientRects().length && (b.textContent.trim() === ${JSON.stringify(text)}
      || b.getAttribute('aria-label') === ${JSON.stringify(text)}))`;
  await until(() => page.evaluate(`Boolean(${selector})`), text);
  await page.evaluate(`${selector}.click()`);
}
async function openFolders(page: Cdp): Promise<void> {
  if (await page.evaluate(`Boolean(document.querySelector('.note-folders')?.getClientRects().length)`)) return;
  const fromList = await page.evaluate(`Array.from(document.querySelectorAll('button')).some(button =>
    button.getClientRects().length && button.getAttribute('aria-label') === '选择文件夹')`);
  await click(page, fromList ? '选择文件夹' : '打开文件夹');
  await until(() => page.evaluate(`Boolean(document.querySelector('[role="dialog"][aria-label="文件夹"]'))`),
    '打开文件夹面板');
}
async function input(page: Cdp, selector: string, value: string): Promise<void> {
  await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function loseFirstWrite(page: Cdp, path: string, key: string): Promise<void> {
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const send = window.fetch.bind(window);
    const key = ${JSON.stringify(key)};
    window.noteReceiptTestHook = key;
    window.fetch = async (url, init) => {
      if (!String(url).endsWith(${JSON.stringify(path)}) || init?.method !== 'POST') { return send(url, init); }
      const bodies = JSON.parse(sessionStorage.getItem(key + '-requests') || '[]');
      bodies.push(JSON.parse(init.body));
      sessionStorage.setItem(key + '-requests', JSON.stringify(bodies));
      const response = await send(url, init);
      if (sessionStorage.getItem(key + '-lost') === null) {
        await response.clone().text();
        sessionStorage.setItem(key + '-lost', 'true');
        throw new TypeError('隔离验收：服务已执行，响应在浏览器处丢失');
      }
      return response;
    };
  })()` });
}
async function shots(page: Cdp, prefix: string, prepare?: () => Promise<void>): Promise<void> {
  const directory = process.env['PLASTICINE_BROWSER_EVIDENCE'];
  if (directory === undefined) { return; }
  await mkdir(directory, { recursive: true });
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [500, 500]]) {
    for (const theme of ['light', 'dark']) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      await page.evaluate(`document.querySelector('.note-pane')?.scrollTo(0, 0)`);
      await prepare?.();
      await pause(80);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false, `${width} 不横向溢出`);
      assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('.note-folders, .note-folder-edit'))
        .some(node => node.scrollWidth > node.clientWidth + 1)`), false, `${width} 文件夹控件不横向截断`);
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(directory, `${prefix}-${width}-${theme}.png`),
        Buffer.from(String(screenshot['data']), 'base64'));
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  // 视口回来了不等于 React 已换回桌面；等当前编辑区跨绘制仍是同一节点再继续操作。
  await until(() => page.evaluate(`(async () => {
    const columns = document.querySelector('.notes-columns[data-phone="false"]');
    if (innerWidth !== 1440 || !columns) return false;
    const target = columns.querySelector('.ProseMirror') ?? columns;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return columns === document.querySelector('.notes-columns[data-phone="false"]')
      && target.isConnected && target === (columns.querySelector('.ProseMirror') ?? columns);
  })()`), '截图后桌面笔记编辑区稳定');
}
/** 补充建议的回答是 JSON 数组（kind / text / draft），这里只给一条「补充」。 */
function supplement(text: string): string {
  return JSON.stringify([{ kind: 'supplement', text, draft: text }]);
}
async function start(t: TestContext, script: TextStep[] = ['自然续写']): Promise<{
  app: TestApp; page: Cdp; base: string;
}> {
  const app = await startTestApp(script, { startTasks: false });
  let vite: ViteDevServer | undefined;
  let browser: LocalBrowser | undefined;
  t.after(async () => { await browser?.close(); await vite?.close(); await app.close(); });
  vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error',
    cacheDir: join(app.directory, 'vite-cache'),
    server: { hmr: false, host: '127.0.0.1', port: 0, proxy: { '/v2': { target: app.base } } } });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  browser = await launchBrowser();
  const page = await browser.page(`${base}/browser-tests/fixtures/notes.html#/notes`);
  current = page;
  await page.send('Page.enable');
  // 等待失败时把页面报过的错（带调用栈）一起带出来：主区落进「这一页出错了」时一眼看到是哪个组件。
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.noteConsoleErrors = [];
    const original = console.error;
    console.error = (...args) => {
      window.noteConsoleErrors.push(args.map(arg => arg?.stack ?? String(arg)).join(' ').slice(0, 3000));
      original(...args);
    };` });
  const [name, value] = (await pair(app)).split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  return { app, page, base };
}

async function layoutShot(page: Cdp, name: string): Promise<void> {
  const directory = process.env['PLASTICINE_NOTES_LAYOUT_EVIDENCE'];
  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(String(shot['data']), 'base64'));
}

async function resizeNotes(page: Cdp, width: number, height: number): Promise<void> {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await pause(200);
  await until(() => page.evaluate(`Boolean(document.querySelector('.notes-columns'))`), '笔记布局就绪');
}

test('笔记缓存：真实HTTP快速切换与离开返回复用已读正文及列表', async (t) => {
  const { app, page } = await start(t);
  const first = app.state.notes.create({ markdown: '# 甲篇\n\n已读的完整上下文', folder: '笔记', author: 'user' });
  const second = app.state.notes.create({ markdown: '# 乙篇\n\n另一篇完整上下文', folder: '笔记', author: 'user' });
  await page.send('Page.enable');
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    window.noteReadRequests = [];
    const send = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(String(input), location.href);
      if ((init?.method ?? 'GET') === 'GET' && /^\\/v2\\/notes(?:\\/[^/]+)?$/.test(url.pathname)) {
        window.noteReadRequests.push(url.pathname + url.search);
      }
      return send(input, init);
    };
  })()` });
  await page.evaluate(`location.hash = '#/notes/${first.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`document.querySelector('.note-body')?.textContent.includes('已读的完整上下文') === true`),
    '首次读取甲篇');
  await until(() => page.evaluate(`document.querySelectorAll('.note-row').length === 2`), '首次列表读取');
  await page.evaluate(`location.hash = '#/notes/${second.id}'`);
  await until(() => page.evaluate(`document.querySelector('.note-body')?.textContent.includes('另一篇完整上下文') === true`),
    '首次读取乙篇');
  const cached = await page.evaluate(`(async () => {
    location.hash = '#/notes/${first.id}';
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return document.querySelector('.note-body')?.textContent.includes('已读的完整上下文') === true;
  })()`);
  assert.equal(cached, true, '返回已读笔记，下一次绘制已有正文');
  await page.evaluate(`location.hash = '#/today'`);
  await until(() => page.evaluate(`!document.querySelector('.notes-columns')`), '离开笔记');
  await page.evaluate(`location.hash = '#/notes/${first.id}'`);
  await until(() => page.evaluate(`document.querySelectorAll('.note-row').length === 2`), '缓存列表直接回显');
  const reads = await page.evaluate<string[]>('window.noteReadRequests');
  assert.equal(reads.filter((url) => url === `/v2/notes/${first.id}`).length, 1, '甲篇仅首次读正文');
  assert.equal(reads.filter((url) => url === `/v2/notes/${second.id}`).length, 1, '乙篇仅首次读正文');
  assert.equal(reads.filter((url) => url === '/v2/notes' || url.startsWith('/v2/notes?')).length, 1,
    '同一列表在新鲜期离开返回不重取');
});

test('笔记阅读布局：按主区宽度让出目录和列表，管理面板不占窄栏，减少动效可用', async (t) => {
  const { app, page } = await start(t);
  const longFolder = 'project-cyber-hunter · 研究资料与实现记录';
  const markdown = '# 工作室里的阅读空间\n\n先把观察写清楚，再整理判断。界面把空间留给正文，' +
    '文件夹和列表帮助找到内容，修改工具在需要的时候出现。\n\n## 下一步\n\n' +
    '在阅读和写作之间自然切换。右侧继续讨论，当前段落和未完成的想法都留在原处。\n\n' +
    '- [ ] 整理最近的阅读记录\n- [ ] 核对原文与来源\n- [ ] 写下自己的下一步判断';
  const note = app.state.notes.create({ markdown, folder: '笔记', author: 'user' });
  const folders = ['想法', '旅行', '生活', 'AI 与 Plasticine', longFolder];
  for (let index = 0; index < 20; index += 1) {
    app.state.notes.create({ markdown: `# ${index % 2 === 0 ? '关于长期记录与阅读的想法' : '留给下一次思考的线索'} ${index + 1}` +
      '\n\n读完以后留下自己的判断，下一次回来可以接着写。',
    folder: folders[index % folders.length]!, author: 'user' });
  }
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开阅读样例');
  await page.evaluate(`window.layoutEditor = ${EDITOR}; void 0`);
  const metrics: unknown[] = [];
  const measure = async (name: string): Promise<void> => {
    // 换宽度时侧栏、列表有收起动效，等它落定再量。
    await pause(400);
    const current = await page.evaluate<{ overflow: string; columns: string; editorWidth: number; mainWidth: number }>(
      `(() => {
        const main = document.querySelector('.shell-main');
        const workspace = document.querySelector('.notes-columns');
        const visible = Array.from(document.querySelectorAll(
          '.note-folders, .note-list, .notes-detail, .note-folder-edit'))
          .filter(node => node.getClientRects().length);
        const wide = visible.filter(node => node.scrollWidth > node.clientWidth + 1)
          .map(node => node.className + ' ' + node.scrollWidth + '>' + node.clientWidth);
        if (document.documentElement.scrollWidth > innerWidth) wide.push('文档 ' + document.documentElement.scrollWidth);
        if (main.scrollWidth > main.clientWidth + 1) wide.push('主区 ' + main.scrollWidth + '>' + main.clientWidth);
        return { overflow: wide.join('；'),
          columns: workspace?.dataset.layout ?? 'phone-home', mainWidth: (workspace ?? main).clientWidth,
          editorWidth: document.querySelector('.note-editor')?.getBoundingClientRect().width ?? 0 };
      })()`);
    assert.equal(current.overflow, '', `${name} 没有横向挤出或截断`);
    if (current.columns === 'split') assert.ok(current.editorWidth >= 440, `${name} 正文保留阅读宽度`);
    metrics.push({ name, ...current });
    await layoutShot(page, name);
  };
  await resizeNotes(page, 2048, 1215);
  assert.equal(await page.evaluate(`document.querySelector('.notes-columns').dataset.layout`), 'wide');
  await click(page, `${longFolder} 4`);
  await until(() => page.evaluate(`document.querySelector('.note-list-heading h2')?.textContent
    === ${JSON.stringify(longFolder)}`), '长目录列表标题');
  await until(() => page.evaluate(`document.querySelectorAll('.note-row').length === 4
    && Boolean(document.querySelector('.note-body .ProseMirror'))`), '长目录笔记列表及正文');
  assert.equal(await page.evaluate(`(() => {
    const title = document.querySelector('.note-list-heading h2').getBoundingClientRect();
    const count = document.querySelector('.note-list-count').getBoundingClientRect();
    return title.right < count.left;
  })()`), true, '长目录标题不压计数');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await measure(`notes-long-folder-2048-${theme}`);
  }
  await click(page, '全部 21');
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await until(() => page.evaluate(`document.querySelector('.note-body')?.textContent.includes('工作室里的阅读空间') === true`),
    '回到主笔记');
  await page.evaluate(`window.layoutEditor = ${EDITOR}; void 0`);
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [500, 500]]) {
    await resizeNotes(page, width!, height!);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      await measure(`notes-reading-${width}-${theme}`);
    }
    if (width! >= 768) {
      assert.equal(await page.evaluate(`window.layoutEditor === ${EDITOR}`), true, '宽度变化保持同一编辑器');
    }
    const single = await page.evaluate(`document.querySelector('.notes-columns').dataset.layout === 'single'`);
    if (single) {
      await click(page, '返回笔记列表');
      // 手机上返回到笔记首层（设计稿 Phone-Notes：文件夹卡 + 最近），点「全部」才是列表。
      if (await page.evaluate(`Boolean(document.querySelector('.phone-notes'))`)) {
        for (const theme of ['light', 'dark']) {
          await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
          await measure(`notes-phone-home-${width}-${theme}`);
        }
        await click(page, '全部 21');
      }
      await until(() => page.evaluate(`Boolean(document.querySelector('.note-list')?.getClientRects().length)`),
        '返回列表');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
        await measure(`notes-list-${width}-${theme}`);
      }
    }
    await openFolders(page);
    await click(page, `管理文件夹${longFolder}`);
    await until(() => page.evaluate(`Boolean(document.querySelector('[role="dialog"][aria-label="管理文件夹"]'))`),
      '独立管理面板');
    assert.equal(await page.evaluate(`document.querySelector('.note-folders')?.contains(
      document.querySelector('.note-folder-edit')) ?? false`), false, '管理表单不占目录列');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
      await measure(`notes-folder-manage-${width}-${theme}`);
    }
    await click(page, '关掉管理文件夹');
    await page.evaluate(`location.hash = '#/notes/${note.id}'`);
    await until(() => page.evaluate(`document.querySelector('.note-body')?.textContent.includes('工作室里的阅读空间') === true`),
      '恢复阅读');
    await page.evaluate(`window.layoutEditor = ${EDITOR}; void 0`);
  }
  // 对话 11-03 起是浮在主区上的对话框（右下角圆球展开），不再占一栏：展开它笔记照旧完整，不挤成单栏。
  await resizeNotes(page, 1280, 900);
  const before = await page.evaluate<string>(`document.querySelector('.notes-columns').dataset.layout`);
  if (!await page.evaluate(`Boolean(document.querySelector('.chat-dialog'))`)) {
    await page.evaluate(`document.querySelector('.chat-ball').click()`);
  }
  await until(() => page.evaluate(`Boolean(document.querySelector('.chat-dialog'))`), '展开对话框');
  assert.equal(await page.evaluate(`document.querySelector('.notes-columns').dataset.layout`), before);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.documentElement.dataset.theme = '${theme}'`);
    await measure(`notes-reading-chat-1280-${theme}`);
  }
  // 对话框贴在右边时占掉主区宽度（11-10 起），量列表收起前先缩回圆球。
  await click(page, '缩小对话框');
  await until(() => page.evaluate(`!document.querySelector('.chat-dialog')`), '缩回圆球');
  await resizeNotes(page, 1440, 900);
  await page.evaluate(`document.querySelector('.note-list').scrollTop = 160`);
  const scroll = await page.evaluate<number>(`document.querySelector('.note-list').scrollTop`);
  await click(page, '收起列表');
  await click(page, '展开列表');
  assert.equal(await page.evaluate(`document.querySelector('.note-list').scrollTop`), scroll, '收起再展开列表保留位置');
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.note-editor')).animationName`), 'none');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.note-list-item')).transitionDuration`),
    '0s');
  const directory = process.env['PLASTICINE_NOTES_LAYOUT_EVIDENCE'];
  if (directory !== undefined) {
    await writeFile(join(directory, 'notes-layout-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  }
});

test('D37–44/49/52：真实HTTP文件夹、全文搜索、元信息、格式图表和三种图片输入、SSE、回收站、直达新建', async (t) => {
  const { app, page } = await start(t);
  const note = app.state.notes.create({ markdown: '# 写作验收\n\n第一段\n\n第二段', folder: '旅行', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
  await openFolders(page);
  await click(page, '新建文件夹');
  await input(page, '.note-folder-edit input', '验收文件夹');
  await click(page, '创建文件夹');
  await until(() => app.state.notes.folders.list().folders.some((folder) => folder.name === '验收文件夹'), '创建文件夹');
  if (await page.evaluate(`Boolean(document.querySelector('button[aria-label="关掉文件夹"]'))`)) {
    await click(page, '关掉文件夹');
  }
  // 改名、移文件夹在正文 ⋯（「更多笔记操作」，2026-11-05 第 3 条：一张小表单，Popover role="dialog"）。
  const actions = `document.querySelector('.note-actions-pop')`;
  await click(page, '更多笔记操作');
  await until(() => page.evaluate(`Boolean(${actions}?.querySelector('input'))`), '笔记 ⋯');
  await input(page, '.note-actions-pop input.popover-field', '整理后的标题');
  await click(page, '保存标题', actions);
  await until(() => app.state.notes.require(note.id).title === '整理后的标题', '保存标题');
  await until(() => page.evaluate(`!${actions}`), '保存后收起');
  await click(page, '更多笔记操作');
  await until(() => page.evaluate(`Array.from(${actions}?.querySelector('select')?.options ?? [])
    .some(o => o.value === '验收文件夹')`), '文件夹选项');
  await page.evaluate(`(() => { const el = ${actions}.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, '验收文件夹');
    el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click(page, '移到此文件夹', actions);
  await until(() => app.state.notes.require(note.id).folder === '验收文件夹', '移动仍是原笔记');
  await page.evaluate(`${EDITOR}.commands.focus('end')`);
  await click(page, '待办');
  assert.ok(await page.evaluate(`Boolean(document.querySelector('.note-body [data-type="taskList"]'))`));
  await click(page, '表格');
  assert.ok(await page.evaluate(`Boolean(document.querySelector('.note-body table th'))`));
  await page.evaluate(`${EDITOR}.commands.focus('end')`);
  await click(page, '图表');
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-chart-block svg'))`), '图表真实渲染');
  await click(page, '改数据');
  await page.evaluate(`document.querySelector('textarea[aria-label="图表数据"]').value =
    '{"type":"line","title":"本次进度","labels":["甲","乙"],"series":[{"name":"完成","values":[2,5]}]}'`);
  await click(page, '保存图表');
  await until(() => page.evaluate(`Boolean(document.querySelector('svg[aria-label="本次进度"]'))`), '修改图表数据');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6KcAAAAASUVORK5CYII=';
  for (const kind of ['paste', 'drop']) {
    await page.evaluate(`(() => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(${JSON.stringify(png)}), c => c.charCodeAt(0))], '${kind}.png',
        { type: 'image/png' }));
      const body = document.querySelector('.note-body .ProseMirror');
      ${EDITOR}.commands.focus('end');
      const event = ${kind === 'paste'
        ? `new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })`
        : `new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: 0, clientY: 0 })`};
      body.dispatchEvent(event);
    })()`);
    const count = kind === 'paste' ? 1 : 2;
    await until(() => page.evaluate(`document.querySelectorAll('.note-body img').length === ${count}`), `${kind}上传图片`);
  }
  const file = join(app.directory, 'upload.png');
  await writeFile(file, Buffer.from(png, 'base64'));
  const root = await page.send('DOM.getDocument');
  const node = await page.send('DOM.querySelector', { nodeId: (root['root'] as { nodeId: number }).nodeId,
    selector: 'input[aria-label="上传笔记图片"]' });
  await page.send('DOM.setFileInputFiles', { nodeId: node['nodeId'], files: [file] });
  await until(() => page.evaluate(`document.querySelectorAll('.note-body img').length === 3`), '图片按钮上传');
  await until(() => app.state.notes.readBody(app.state.notes.require(note.id)).includes('upload.png'), '图片已保存');
  await shots(page, 'notes-editor');
  const saved = app.state.notes.require(note.id);
  app.state.notes.saveAs(note.id, saved.version, {
    markdown: `${app.state.notes.readBody(saved)}\n\nPlasticine追加正文线索`,
  }, 'ai');
  app.app.deps.hub.publish({ type: 'note_invalidated', noteId: note.id });
  await until(() => page.evaluate(`document.body.textContent.includes('Plasticine · 已写入这里')`), 'SSE同步与真实作者光标');
  await input(page, 'input[aria-label="搜索笔记"]', '追加正文线索');
  await until(() => page.evaluate(`document.querySelectorAll('.note-row').length === 1`), '正文全文搜索');
  await click(page, '更多笔记操作');
  await click(page, '删除笔记', `document.querySelector('.note-actions-pop')`);
  await click(page, '移到最近删除');
  await until(() => page.evaluate(`location.hash === '#/notes'`), '删除后返回');
  await openFolders(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('button[aria-label="最近删除 1"]'))`), '回收站计数');
  await page.evaluate(`document.querySelector('button[aria-label="最近删除 1"]').click()`);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-row'))`), '回收站正文列表');
  await page.evaluate(`document.querySelector('.note-row').click()`);
  await click(page, '恢复笔记');
  await until(() => app.state.notes.require(note.id).deletedAt === null, '恢复成功');
  assert.equal(app.state.notes.require(note.id).folder, '验收文件夹');
  const count = app.state.notes.list().length;
  await page.evaluate(`location.hash = '#/notes/new'`);
  await until(() => app.state.notes.list().length === count + 1, '快捷链接仅新建一篇');
  await until(() => page.evaluate(`location.hash !== '#/notes/new'`), '切到新笔记实体链接');
  assert.equal(app.state.notes.list().length, count + 1);
});

test('D45/47/48：浏览器预测采用、AI对照保留新输入、保存冲突沿用同一面板', async (t) => {
  const { app, page } = await start(t, ['自然续写', '# 思路\n\n甲段改\n\n乙段改']);
  const note = app.state.notes.create({ markdown: '# 思路\n\n甲段\n\n正在写作的文字', folder: '笔记', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
  await page.evaluate(`${EDITOR}.commands.focus('end')`);
  assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('label'))
    .find(l => l.textContent.trim() === '续写').querySelector('input').checked`), true, '新设备默认启用预测');
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-ghost'))`), '出现灰字预测');
  assert.equal(await page.evaluate(`document.querySelector('.ProseMirror .note-ghost') === null`), true,
    '候选处于可编辑DOM之外，避免打断输入法');
  await page.evaluate(`document.querySelector('.note-body .ProseMirror').focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(() => page.evaluate(`${EDITOR}.getText().includes('自然续写')`), 'Tab采用预测');
  await page.evaluate(`Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === '续写')
    .querySelector('input').click()`);
  await page.evaluate(`${EDITOR}.commands.setContent(${JSON.stringify('# 思路\n\n甲段\n\n乙段')},
    { contentType: 'markdown' })`);
  // AI 写作是下拉菜单（DropdownMenu，role="menu"），整篇的几样在里面。
  await click(page, 'AI 写作');
  await until(() => page.evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]'))
    .some(item => item.textContent.trim() === '整篇润色')`), 'AI 写作菜单');
  await page.evaluate(`Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(item => item.textContent.trim() === '整篇润色').click()`);
  await until(() => page.evaluate(`Boolean(document.querySelector('[aria-label="笔记改动对照"]'))`), 'AI先展示对照');
  assert.ok(!await page.evaluate(`${EDITOR}.getText().includes('甲段改')`));
  await shots(page, 'notes-ai-review', async () => {
    await page.evaluate(`document.querySelector('.note-review')?.scrollIntoView({ block: 'start' })`);
  });
  await page.evaluate(`document.querySelectorAll('.note-review input[type="checkbox"]')[1].click()`);
  await page.evaluate(`${EDITOR}.commands.insertContentAt(${EDITOR}.state.doc.content.size, '<p>继续写下的一句</p>')`);
  await click(page, '采用所选');
  assert.ok(await page.evaluate(`${EDITOR}.getText().includes('甲段改') && ${EDITOR}.getText().includes('继续写下的一句')`));
  assert.ok(!await page.evaluate(`${EDITOR}.getText().includes('乙段改')`));
  await until(() => app.state.notes.readBody(app.state.notes.require(note.id)).includes('继续写下的一句'), '采用后保存');
  await page.evaluate(`${EDITOR}.commands.insertContentAt(${EDITOR}.state.doc.content.size, '<p>本地未存</p>')`);
  const saved = app.state.notes.require(note.id);
  app.state.notes.saveAs(note.id, saved.version, { markdown: `${app.state.notes.readBody(saved)}\n\n别处的新版本` }, 'ai');
  app.app.deps.hub.publish({ type: 'note_invalidated', noteId: note.id });
  await until(() => page.evaluate(`document.body.textContent.includes('保存冲突 · 对照新版本')`), '冲突进入逐处对照');
  assert.ok(await page.evaluate(`${EDITOR}.getText().includes('本地未存')`));
  await shots(page, 'notes-conflict');
  await click(page, '保留我的');
  await until(() => app.state.notes.readBody(app.state.notes.require(note.id)).includes('本地未存'), '解决冲突保留草稿');
});

test('笔记续写：真实输入法取消迟到请求，光标移动重新预测，Tab只在当前光标采用', async (t) => {
  const first = Promise.withResolvers<void>();
  const { app, page } = await start(t, [async () => {
    await first.promise;
    return { text: '不应出现的迟到候选', complete: true };
  }, '，然后把事实记清楚。']);
  t.after(() => first.resolve());
  const note = app.state.notes.create({ markdown: '正在记录这段经历\n\n后文已写好的结论。', folder: '笔记', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
  await page.evaluate(`${EDITOR}.chain().focus().setTextSelection(${EDITOR}.state.doc.child(0).nodeSize - 1).run()`);
  await until(() => app.requests.length === 1, '首个预测已开始');
  await page.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  assert.equal(await page.evaluate(`${EDITOR}.view.composing`), true, '真实浏览器处于组合输入');
  first.resolve();
  await pause(100);
  assert.equal(await page.evaluate(`document.querySelector('.note-ghost') === null`), true, '组合期间忽略迟到候选');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await page.evaluate(`${EDITOR}.getText().includes('迟到候选')`), false, '输入法中的Tab不接受候选');
  await page.send('Input.insertText', { text: '文' });
  await until(() => page.evaluate(`!${EDITOR}.view.composing`), '组合输入提交');
  await page.evaluate(`${EDITOR}.chain().focus().setTextSelection(${EDITOR}.state.doc.child(0).nodeSize - 1).run()`);
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === '，然后把事实记清楚。'`),
    '输入法完成后重新预测');
  assert.match(JSON.stringify(app.requests.at(-1)?.messages), /后文已写好的结论/);
  await shots(page, 'notes-cursor-prediction');
  // 多尺寸取证会让编辑器失焦；像用户回到正文一样恢复焦点和原光标，再验证移动会撤掉建议。
  await page.evaluate(`${EDITOR}.chain().focus().setTextSelection(${EDITOR}.state.doc.child(0).nodeSize - 1).run()`);
  await until(() => page.evaluate(`${EDITOR}.isFocused && document.activeElement === ${EDITOR}.view.dom`),
    '截图后正文重新取得焦点');
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === '，然后把事实记清楚。'`),
    '截图后原光标的续写建议恢复');
  await page.evaluate(`${EDITOR}.commands.setTextSelection(1)`);
  assert.equal(await page.evaluate(`document.querySelector('.note-ghost') === null`), true, '移动光标立刻撤去旧建议');
  await page.evaluate(`${EDITOR}.commands.setTextSelection(${EDITOR}.state.doc.child(0).nodeSize - 1)`);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-ghost'))`), '移回段尾自动重新预测');
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(() => app.state.notes.readBody(app.state.notes.require(note.id)).includes('把事实记清楚'), 'Tab采用后自动保存');
  const markdown = await page.evaluate<string>(`${EDITOR}.getMarkdown()`);
  assert.match(markdown, /中文/);
  assert.match(markdown, /把事实记清楚。\n\n后文已写好的结论/);
  assert.doesNotMatch(markdown, /迟到候选/);
});

// 2026-11-09 他说「会和我正在输入的文字冲突，导致我正在输入的文字出现两遍」：灰字在时用拼音输入法打字。组字期间
// 不能有改装饰的事务打在正在组的那一段上；组完提交的字是灰字开头就接着显示剩下的，不是就撤下；正文里那几个字只出现一次。
test('灰字在时中文输入法组字：组字中不发改装饰的事务、灰字只是藏起来；组完提交的字只出现一次，对得上灰字接着显示', async (t) => {
  const { app, page } = await start(t, ['然后把事实记清楚。', '但是还有别的解释。']);
  const note = app.state.notes.create({ markdown: '正在记录这段经历\n\n后文已写好的结论。', folder: '笔记', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
  const end = `${EDITOR}.state.doc.child(0).nodeSize - 1`;
  await page.evaluate(`${EDITOR}.chain().focus().setTextSelection(${end}).run()`);
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === '然后把事实记清楚。'`),
    '灰字出现');
  await pause(100);
  await page.evaluate(`(() => { window.imeLog = [];
    ${EDITOR}.on('transaction', ({ transaction }) => window.imeLog.push({ doc: transaction.docChanged,
      composing: ${EDITOR}.view.composing })); })(); 0`);
  for (const text of ['r', 'ra', 'ran', 'ran h', 'ran ho', 'ran hou']) {
    await page.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await pause(20);
  }
  assert.equal(await page.evaluate(`${EDITOR}.view.composing`), true, '真实浏览器处于组字');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.note-ghost-line')).visibility`), 'hidden',
    '组字时灰字藏起来');
  await page.send('Input.insertText', { text: '然后' });
  await until(() => page.evaluate(`!${EDITOR}.view.composing`), '组字提交');
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === '把事实记清楚。'`),
    '组完对得上，灰字接着显示剩下的');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.note-ghost-line')).visibility`),
    'visible');
  const log = await page.evaluate<{ doc: boolean; composing: boolean }[]>('window.imeLog');
  assert.deepEqual(log.filter((entry) => entry.composing && !entry.doc), [], '组字期间没有只改装饰的事务');
  const first = await page.evaluate<string>(`${EDITOR}.state.doc.child(0).textContent`);
  assert.equal(first, '正在记录这段经历然后', '提交的字只出现一次');
  assert.equal(app.requests.length, 1, '照着打不重新要');
  for (const text of ['d', 'da', 'dan', 'dan s', 'dan sh', 'dan shi']) {
    await page.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await pause(20);
  }
  await page.send('Input.insertText', { text: '但是' });
  await until(() => page.evaluate(`!${EDITOR}.view.composing`), '第二次组字提交');
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent !== '把事实记清楚。'`),
    '对不上的灰字撤下');
  assert.equal(await page.evaluate<string>(`${EDITOR}.state.doc.child(0).textContent`), '正在记录这段经历然后但是');
  // 模型的第二条开头又写了一遍刚打的「但是」：服务端去掉了，灰字从「还有」开始。
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === '还有别的解释。'`),
    '停笔后再要一次，重复的开头去掉');
  assert.equal(app.requests.length, 2);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(() => app.state.notes.readBody(app.state.notes.require(note.id)).includes('还有别的解释'), 'Tab采用后保存');
  const markdown = await page.evaluate<string>(`${EDITOR}.getMarkdown()`);
  assert.equal(markdown.match(/然后/g)?.length, 1);
  assert.equal(markdown.match(/但是/g)?.length, 1, '模型重复的「但是」去掉了，收下后只有一处');
});

test('笔记建议贴着正文：编号列表里Tab采用续写、灰字在光标行、补充建议在段落下方、选段工具不挡选中的字',
  async (t) => {
    const long = '，接着把第二项写完整，不在半句停下，也不受字数限制，一直写到这一段自然结束的地方。';
    const { app, page } = await start(t, [long, supplement('要不要先列出验证这件事的证据？')]);
    const note = app.state.notes.create({ markdown: '1. 第一项要点\n2. 正在写的第二项', folder: '笔记', author: 'user' });
    await page.evaluate(`location.hash = '#/notes/${note.id}'`);
    await reloadPage(page);
    await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
    await page.evaluate(`${EDITOR}.commands.focus('end')`);
    await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === ${JSON.stringify(long)}`),
      '出现完整续写');
    const placed = await page.evaluate<{ ghost: number; item: number; bar: number }>(`(() => {
      const items = document.querySelectorAll('.note-body li');
      return { ghost: document.querySelector('.note-ghost').getBoundingClientRect().top,
        item: items[items.length - 1].getBoundingClientRect().top,
        bar: document.querySelector('.note-command-bar').getBoundingClientRect().bottom };
    })()`);
    assert.ok(Math.abs(placed.ghost - placed.item) < 12, '灰字和光标在同一行');
    assert.ok(placed.ghost > placed.bar, '灰字在正文里，不在顶部工具栏');
    assert.equal(await page.evaluate(`document.querySelector(
      '.note-command-bar .note-suggestion, .note-command-bar kbd')
      === null`), true, '工具栏里没有建议条');
    await layoutShot(page, 'notes-list-prediction');
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await until(() => page.evaluate(`${EDITOR}.getText().includes('一直写到这一段自然结束的地方。')`), 'Tab采用续写');
    assert.equal(await page.evaluate(`document.querySelectorAll('.note-body ol ol, .note-body li li').length`), 0,
      'Tab没有把这一项缩进成下一级');
    assert.equal(await page.evaluate(`document.querySelectorAll('.note-body li').length`), 2);
    await page.evaluate(`Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === '续写')
      .querySelector('input').click()`);
    await page.evaluate(`Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === '补充建议')
      .querySelector('input').click()`);
    await page.evaluate(`${EDITOR}.commands.focus('end');
      ${EDITOR}.commands.insertContent(${JSON.stringify('想清楚为什么这件事值得做。'.repeat(8))})`);
    await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .note-suggestion'))`), '补充建议出现');
    // 正在写的那段（Tab 采用续写后光标落到列表下面的新段）：量它文字的底边，不算给建议让出的空白。
    const below = await page.evaluate<{ top: number; item: number }>(`(() => {
      const block = Array.from(document.querySelectorAll('.note-body .ProseMirror > *'))
        .filter(node => node.textContent.includes('想清楚')).pop();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let bottom = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        bottom = Math.max(bottom, range.getBoundingClientRect().bottom);
      }
      return { top: document.querySelector('.note-body .note-suggestion').getBoundingClientRect().top, item: bottom };
    })()`);
    assert.ok(below.top >= below.item, `补充建议在当前段落下方，不盖住正在写的字 ${JSON.stringify(below)}`);
    await layoutShot(page, 'notes-interject');
    await click(page, '不用', `document.querySelector('.note-suggestion')`);
    await page.evaluate(`Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === '补充建议')
      .querySelector('input').click()`);
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await pause(150);
      await page.evaluate(`${EDITOR}.chain().focus()
        .setTextSelection({ from: 3, to: ${EDITOR}.state.doc.content.size - 3 })
        .run()`);
      await until(() => page.evaluate(`Boolean(document.querySelector('.note-selection-tools'))`), `${width} 选段工具出现`);
      await pause(50);
      const covered = await page.evaluate<boolean>(`(() => {
        const tools = document.querySelector('.note-selection-tools').getBoundingClientRect();
        const rects = Array.from(getSelection().getRangeAt(0).getClientRects()).filter(r => r.width > 0);
        return rects.some(r => r.top < tools.bottom && r.bottom > tools.top
          && r.left < tools.right && r.right > tools.left);
      })()`);
      assert.equal(covered, false, `${width} 选段工具不挡住选中的字`);
      await layoutShot(page, `notes-selection-${width}`);
      await page.evaluate(`${EDITOR}.commands.setTextSelection(1)`);
    }
  });

test('续写和补充同时在：灰字在光标行、补充排在灰字下面不叠，Tab 采用续写，补充随之撤下', async (t) => {
  const long = '，再把这件事和上周的记录对一下，看看哪些是实际发生的，哪些是当时的解释，一条一条分开写清楚。';
  const { app, page } = await start(t, [async (request) => ({
    text: request.system.includes('补充') ? supplement('要不要先列出验证这件事的证据？') : long, complete: true })]);
  const note = app.state.notes.create({ markdown: '开头', folder: '笔记', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
  await page.evaluate(`Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === '补充建议')
    .querySelector('input').click()`);
  await page.evaluate(`${EDITOR}.commands.focus('end');
    ${EDITOR}.commands.insertContent(${JSON.stringify('想清楚为什么这件事值得做。'.repeat(8))})`);
  await until(() => page.evaluate(`document.querySelector('.note-ghost')?.textContent === ${JSON.stringify(long)}`),
    '先出续写');
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .note-suggestion'))`), '再出补充');
  await pause(100);
  const placed = await page.evaluate<{ ghost: number; suggestion: number }>(`(() => {
    const ghost = document.querySelector('.note-ghost-line').getBoundingClientRect();
    const suggestion = document.querySelector('.note-body .note-suggestion').getBoundingClientRect();
    return { ghost: ghost.bottom, suggestion: suggestion.top };
  })()`);
  assert.ok(placed.suggestion >= placed.ghost, '补充在续写灰字下面，不叠在一起');
  assert.ok(await page.evaluate(`Boolean(document.querySelector('.note-ghost'))`), '补充出现后续写还在');
  await layoutShot(page, 'notes-predict-and-interject');
  await page.evaluate(`document.querySelector('.note-body .ProseMirror').focus()`);
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await until(() => page.evaluate(`${EDITOR}.getText().includes(${JSON.stringify(long)})`), 'Tab采用续写');
  assert.equal(await page.evaluate(`${EDITOR}.getText().includes('验证这件事的证据')`), false, 'Tab不采用补充');
  assert.equal(await page.evaluate(`document.querySelector('.note-suggestion') === null`), true, '正文改了补充撤下');
});

test('笔记选段写作：保留选择与上下文，自定义要求、编辑修改稿、手机引用接续', async (t) => {
  const { app, page } = await start(t, ['调整后的句子。']);
  const note = app.state.notes.create({ markdown: '前文背景。\n\n原来的句子。\n\n后文结论。', folder: '笔记', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开正文');
  await page.evaluate(`(() => { const editor = ${EDITOR}; const from = editor.state.doc.child(0).nodeSize + 1;
    editor.chain().focus().setTextSelection({ from, to: from + 6 }).run(); })()`);
  await click(page, '按要求修改选段');
  await input(page, 'textarea[aria-label="修改要求"]', '结合前文，把这句话说清楚');
  await shots(page, 'notes-selected-instruction', async () => {
    await page.evaluate(`document.querySelector('.note-ai-prompt')?.scrollIntoView({ block: 'start' })`);
  });
  await click(page, '生成修改稿');
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-review'))`), '生成选段修改稿');
  assert.match(JSON.stringify(app.requests.at(-1)?.messages), /前文背景/);
  assert.match(JSON.stringify(app.requests.at(-1)?.messages), /后文结论/);
  assert.equal(await page.evaluate(`${EDITOR}.getMarkdown()`), '前文背景。\n\n原来的句子。\n\n后文结论。');
  await click(page, '编辑修改稿');
  await input(page, 'textarea[aria-label="修改稿"]', '前文背景。\n\n自己再调整后的句子。\n\n后文结论。');
  await shots(page, 'notes-edit-draft', async () => {
    await page.evaluate(`document.querySelector('.note-review')?.scrollIntoView({ block: 'start' })`);
  });
  await click(page, '采用所选');
  await until(() => app.state.notes.readBody(app.state.notes.require(note.id)).includes('自己再调整'), '所选修改保存');
  assert.equal(await page.evaluate(`${EDITOR}.getMarkdown()`), '前文背景。\n\n自己再调整后的句子。\n\n后文结论。');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: false,
  });
  await page.evaluate(`${EDITOR}.commands.setTextSelection({ from: 1, to: 5 })`);
  await click(page, '引用到对话');
  // 手机上对话是整屏的对话框（11-03）：引用之后它打开、输入框看得见。
  await until(() => page.evaluate(`Array.from(document.querySelectorAll('textarea[aria-label="问一句"]')).some(node =>
    node.getClientRects().length && node.closest('.chat-dialog, [role="dialog"]'))`), '手机对话随引用打开');
  assert.equal(await page.evaluate(`document.querySelector('.note-selection-tools') === null`), true, '引用后收起选段工具');
});

test('D37：改名已落地但回执丢失，切页刷新后原请求核实；打开的笔记同步文件夹', async (t) => {
  const { app, page } = await start(t);
  const note = app.state.notes.create({ markdown: '# 原笔记\n\n正文仍在', folder: '旧文件夹', author: 'user' });
  await loseFirstWrite(page, '/v2/notes/folders', 'folder-test');
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))`), '打开原笔记');
  assert.equal(await page.evaluate('window.noteReceiptTestHook'), 'folder-test', '响应丢失注入已加载');
  await openFolders(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('[aria-label="管理文件夹旧文件夹"]'))`), '旧文件夹');
  await page.evaluate(`document.querySelector('[aria-label="管理文件夹旧文件夹"]').click()`);
  await input(page, '.note-folder-edit input', '新文件夹');
  await page.evaluate(`(() => {
    const save = Array.from(document.querySelector('.note-folder-edit').querySelectorAll('button'))
      .find(button => button.textContent.trim() === '保存名称');
    save.click(); save.click();
  })()`);
  await until(() => app.state.notes.require(note.id).folder === '新文件夹', '真实数据库已改名');
  const pending = `document.querySelector('[aria-label="还没了结的文件夹操作"]')`;
  await until(() => page.evaluate(`${pending}?.textContent.includes('再核实') === true`), '明确显示回执待核实');
  // 正文上方不再写文件夹（笔记页头精简后），看列表里这一篇的文件夹标签。
  await until(() => page.evaluate(`Array.from(document.querySelectorAll('.note-row-folder'))
    .some(tag => tag.textContent === '新文件夹')`),
    '服务端事件同步打开笔记的文件夹');
  assert.equal(app.state.notes.require(note.id).version, note.version + 1);
  assert.equal(await page.evaluate(`JSON.parse(sessionStorage.getItem('folder-test-requests')).length`), 1);
  await page.evaluate(`location.hash = '#/notes'`);
  await shots(page, 'notes-folder-retry', async () => {
    await page.evaluate(`${pending}?.scrollIntoView({ block: 'center' })`);
  });
  await page.evaluate(`location.hash = '#/today'`);
  await until(() => page.evaluate(`!document.querySelector('.note-folders')`), '离开笔记页');
  await page.evaluate(`location.hash = '#/notes'`);
  await until(() => page.evaluate(`Boolean(${pending})`), '返回仍能核实原文件夹操作');
  await reloadPage(page);
  await until(() => page.evaluate(`${pending}?.textContent.includes('再核实') === true`), '刷新保留原操作');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 1, mobile: false,
  });
  // 手机上没有侧栏，没了结的文件夹操作跟着笔记首层的文件夹一起显示。
  await until(() => page.evaluate(`Boolean(${pending})`), '手机文件夹面板里的原操作');
  await page.evaluate(`${pending}.scrollIntoView({ block: 'center' })`);
  await click(page, '再核实', pending);
  await until(() => page.evaluate(`!${pending}`), '原操作取得明确回执');
  const bodies = await page.evaluate<unknown[]>(`JSON.parse(sessionStorage.getItem('folder-test-requests'))`);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  assert.equal(app.state.notes.require(note.id).version, note.version + 1);
  assert.equal(app.state.notes.readBody(app.state.notes.require(note.id)), '# 原笔记\n\n正文仍在');
  assert.equal(app.state.notes.folders.list().folders.some((folder) => folder.name === '旧文件夹'), false);
});

test('D38：恢复已落地但回执丢失，刷新后可核实且不再写一版', async (t) => {
  const { app, page } = await start(t);
  const note = app.state.notes.create({ markdown: '# 待恢复\n\n保留原文', folder: '原文件夹', author: 'user' });
  app.state.notes.markDeleted(note.id);
  const deleted = app.state.notes.require(note.id);
  await loseFirstWrite(page, `/v2/notes/${note.id}/restore`, 'restore-test');
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await click(page, '恢复笔记');
  assert.equal(await page.evaluate('window.noteReceiptTestHook'), 'restore-test', '响应丢失注入已加载');
  await until(() => app.state.notes.require(note.id).deletedAt === null, '恢复实际写入数据库');
  await until(() => page.evaluate(`document.querySelector('.notes-pending')?.textContent.includes('恢复一篇') === true`),
    '恢复按钮消失后仍呈现明确的待核实入口');
  await until(() => page.evaluate(`!Array.from(document.querySelectorAll('button'))
    .some(button => button.textContent.trim() === '恢复笔记')`), 'SSE使恢复按钮消失');
  await page.evaluate(`location.hash = '#/today'`);
  await until(() => page.evaluate(`!document.querySelector('.notes')`), '离开笔记页');
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await reloadPage(page);
  await until(() => page.evaluate(`Boolean(document.querySelector('.notes-pending'))`), '刷新恢复原核实入口');
  await click(page, '再核实', `document.querySelector('.notes-pending')`);
  await until(() => page.evaluate(`!document.querySelector('.notes-pending')`), '刷新后的原恢复请求核实完成');
  const bodies = await page.evaluate<unknown[]>(`JSON.parse(sessionStorage.getItem('restore-test-requests'))`);
  assert.equal(bodies.length, 2);
  assert.deepEqual(bodies[1], bodies[0]);
  const current = app.state.notes.require(note.id);
  assert.equal(current.version, deleted.version + 1);
  assert.equal(current.folder, '原文件夹');
  assert.equal(app.state.notes.readBody(current), '# 待恢复\n\n保留原文');
});

test('D46/50/51：导入三版与差异、合并原版双向导航、接话不用或明确加上', async (t) => {
  const { app, page } = await start(t, [supplement('先搁置的一句观察。'), supplement('采用的一句额外思考。')]);
  const merged = app.state.notes.create({ markdown: '# 合并结果\n\n结果保持可编辑。', folder: '笔记', author: 'user' }, {
    legacyPayload: { note: { merges: [{ fromId: 'old-original' }] } },
  });
  const originalText = '# 原文\n\n原话原样保留。';
  const correctedText = '# 校对\n\n校对保留事实。';
  const polishedText = '# 润色\n\n润色后的表达。';
  const original = app.state.notes.create({ markdown: polishedText, folder: '已合并（原版）', author: 'ai', readOnly: true }, {
    legacyPayload: { note: { versions: { import: 1, proofread: 3, polish: 5 }, history: [
      { revision: 1, markdown: originalText }, { revision: 3, markdown: correctedText },
      { revision: 5, markdown: polishedText },
    ], mergedInto: { id: 'old-merged' } } },
  });
  for (const [legacyId, targetId] of [['old-original', original.id], ['old-merged', merged.id]]) {
    app.state.legacyIds.record({ sourceDb: 'files/notes', sourceTable: 'note-json', legacyId: legacyId!,
      targetTable: 'notes', targetId: targetId! });
  }
  await page.evaluate(`location.hash = '#/notes/${original.id}'`);
  await reloadPage(page);
  const variant = `document.querySelector('[aria-label="导入版本正文"]')`;
  await until(() => page.evaluate(`Boolean(${variant})`), '真实旧结构的导入三版');
  await page.evaluate(`Array.from(document.querySelectorAll('.note-import summary'))
    .find(summary => summary.textContent.trim() === '导入的原文 / 校对 / 润色').click()`);
  assert.ok(await page.evaluate(`${variant}.textContent.includes('原话原样保留')`));
  await click(page, '校对', `document.querySelector('.note-import')`);
  await until(() => page.evaluate(`${variant}.textContent.includes('校对保留事实')`), '切换校对版');
  await click(page, '润色', `document.querySelector('.note-import')`);
  await until(() => page.evaluate(`${variant}.textContent.includes('润色后的表达')`), '切换润色版');
  await page.evaluate(`Array.from(document.querySelectorAll('.note-import summary'))
    .find(summary => summary.textContent.trim().startsWith('比原文改了')).click()`);
  assert.ok(await page.evaluate(`Array.from(document.querySelectorAll('.note-import del'))
    .some(before => before.textContent.includes('原话原样保留'))`));
  assert.equal(app.state.notes.readBody(app.state.notes.require(original.id)), polishedText, '切换只读版本不改正文');
  await shots(page, 'notes-import');
  await page.evaluate(`document.querySelector('.note-import a[href="#/notes/${merged.id}"]').click()`);
  await until(() => page.evaluate(`document.querySelector('.note-body .ProseMirror')?.textContent
    .includes('结果保持可编辑') === true`), '原版跳合并结果');
  await until(() => page.evaluate(`Array.from(document.querySelectorAll('.note-import summary'))
    .some(summary => summary.textContent.trim() === '合并 1 份原版')`), '导入关系单独加载完毕');
  await page.evaluate(`Array.from(document.querySelectorAll('.note-import summary'))
    .find(summary => summary.textContent.trim() === '合并 1 份原版').click()`);
  await page.evaluate(`document.querySelector('.note-import a[href="#/notes/${original.id}"]').click()`);
  await until(() => page.evaluate(`location.hash === '#/notes/${original.id}'
    && document.querySelector('.note-import')?.textContent.includes('这份原版已合并进') === true`), '结果列表跳回原版');
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-import a[href="#/notes/${merged.id}"]'))`),
    '返回原版后合并链接就绪');
  await page.evaluate(`document.querySelector('.note-import a[href="#/notes/${merged.id}"]').click()`);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-ai-tools'))`), '回到可编辑结果');
  // 这里只看补充：续写各管各的，开着会先用掉脚本里的回答（两个都开的测试在「续写和补充同时在」）。
  for (const name of ['续写', '补充建议']) {
    await page.evaluate(`Array.from(document.querySelectorAll('.note-ai-switch')).find(label =>
      label.textContent.trim() === ${JSON.stringify(name)}).querySelector('input').click()`);
  }
  const paragraph = '我正在把一段经历记下来，想分清实际发生的事和自己的解释。'.repeat(4);
  await page.evaluate(`${EDITOR}.commands.focus('end');
    ${EDITOR}.commands.insertContent(${JSON.stringify(paragraph)})`);
  await until(() => page.evaluate(`document.querySelector('.note-suggestion')?.textContent
    .includes('先搁置的一句观察') === true`), '停顿后真实HTTP接话');
  const before = await page.evaluate<string>(`${EDITOR}.getMarkdown()`);
  await click(page, '不用', `document.querySelector('.note-suggestion')`);
  assert.equal(await page.evaluate(`${EDITOR}.getMarkdown()`), before, '不用不会写进正文');
  await page.evaluate(`(() => { const realNow = Date.now; Date.now = () => realNow() + 61_000; })()`);
  await page.evaluate(`${EDITOR}.commands.focus('end');
    ${EDITOR}.commands.insertContent(${JSON.stringify(paragraph)})`);
  await until(() => page.evaluate(`document.querySelector('.note-suggestion')?.textContent
    .includes('采用的一句额外思考') === true`), '一分钟后新一段触发接话');
  assert.ok(!await page.evaluate(`${EDITOR}.getText().includes('采用的一句额外思考')`));
  await click(page, '加上', `document.querySelector('.note-suggestion')`);
  await click(page, '留下', `document.querySelector('.note-suggestion-draft')`);
  await until(() => app.state.notes.readBody(app.state.notes.require(merged.id)).includes('采用的一句额外思考'),
    '只有加上后才实际保存');
  assert.ok(!app.state.notes.readBody(app.state.notes.require(merged.id)).includes('先搁置的一句观察'));
});
