// 笔记编辑器在真浏览器里的输入（11-12 全量优化第 2、3、12 条）：键入 / 粘贴 / 复制 Markdown；输入法组字和续写交错；
// 接受、忽略续写之后的撤销重做；快速切换笔记时迟到的续写不串到另一篇；续写请求失败不影响打字。
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer, type ViteDevServer } from 'vite';
import { launchBrowser, type Cdp, type LocalBrowser } from '../../scripts/browser/cdp.ts';
import { pair, startTestApp, type TestApp } from '../../agent/tests/app/helpers.ts';
import type { TextStep } from '../../agent/tests/brain/helpers.ts';
import { reloadPage } from './reload.ts';

const EDITOR = `document.querySelector('.note-body .ProseMirror').editor`;
const TYPES = `JSON.stringify(${EDITOR}.getJSON().content.map(n => n.type + (n.attrs?.level ?? '')))`;
const GHOST = `document.querySelector('.note-ghost')?.textContent ?? null`;
const SAVE_MS = 1700;

async function until(done: () => Promise<boolean> | boolean, label: string): Promise<void> {
  const deadline = Date.now() + 12_000;
  while (!await done()) {
    if (Date.now() > deadline) { throw new Error(`笔记输入等待失败：${label}`); }
    await pause(25);
  }
}

async function start(t: TestContext, script: TextStep[]): Promise<{ app: TestApp; page: Cdp }> {
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
  await page.send('Page.enable');
  const [name, value] = (await pair(app)).split('=');
  await page.send('Network.setCookie', { name, value, url: base });
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1,
    mobile: false });
  await reloadPage(page);
  return { app, page };
}

/** 打开一篇（不整页刷新：上一篇没存完时刷新会被「离开此页」拦住）。 */
async function open(page: Cdp, app: TestApp, markdown: string): Promise<string> {
  const note = app.state.notes.create({ markdown, folder: '笔记', author: 'user' });
  await page.evaluate(`location.hash = '#/notes/${note.id}'`);
  await until(() => page.evaluate(`Boolean(document.querySelector('.note-body .ProseMirror'))
    && ${EDITOR}.getText().trim() === ${JSON.stringify(markdown.trim())} && window.shownNote !== '${note.id}'`),
  '打开正文');
  await page.evaluate(`window.shownNote = '${note.id}'`);
  await page.evaluate(`${EDITOR}.commands.focus('end')`);
  // 焦点刚交给正文时紧跟着发的第一个键会丢（调试协议的输入，不是产品行为）：等焦点落定。
  await until(() => page.evaluate(`${EDITOR}.isFocused && document.activeElement === ${EDITOR}.view.dom`), '正文取得焦点');
  await pause(250);
  return note.id;
}

async function typeKeys(page: Cdp, text: string): Promise<void> {
  for (const char of text) {
    if (char === '\n') {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, text: '\r' });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13 });
    } else {
      await page.send('Input.dispatchKeyEvent', { type: 'char', text: char });
    }
    await pause(30);
  }
}

async function compose(page: Cdp, pinyin: string, committed: string, stepMs = 30): Promise<void> {
  for (let index = 1; index <= pinyin.length; index += 1) {
    const text = pinyin.slice(0, index);
    await page.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await pause(stepMs);
  }
  await page.send('Input.insertText', { text: committed });
}

async function key(page: Cdp, name: 'Tab' | 'Escape', code: number): Promise<void> {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code });
}

test('键入、粘贴、复制 Markdown：中文里的记号照样转换，转换能撤销重做，存下来的不带实体', async (t) => {
  const { app, page } = await start(t, Array.from({ length: 60 }, () => ''));
  await page.evaluate(`localStorage.setItem('plasticine.notes-ui', JSON.stringify({ predict: false, interject: false }))`);

  await open(page, app, '');
  await typeKeys(page, '这是**加粗**的字');
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '这是加粗的字');
  assert.match(await page.evaluate<string>(`JSON.stringify(${EDITOR}.getJSON())`), /"type":"bold"/);
  await page.evaluate(`${EDITOR}.commands.undo(); ${EDITOR}.commands.undo()`);
  assert.match(await page.evaluate<string>(`${EDITOR}.getText()`), /\*\*加粗\*\*/, '撤销回到键入的原样');
  await page.evaluate(`${EDITOR}.commands.redo(); ${EDITOR}.commands.redo()`);
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '这是加粗的字', '重做回来');
  await pause(SAVE_MS);

  await open(page, app, '');
  await typeKeys(page, '```\nconst a = 1;');
  assert.equal(await page.evaluate(TYPES), '["codeBlock","paragraph"]', '三个反引号后回车开代码块');
  assert.equal(await page.evaluate(`${EDITOR}.getJSON().content[0].content[0].text`), 'const a = 1;');
  await pause(SAVE_MS);

  // 中文输入法：标点经组字提交，后面的空格直接键入；正文接着用拼音打。
  const quoted = await open(page, app, '');
  await page.send('Input.imeSetComposition', { text: '》', selectionStart: 1, selectionEnd: 1 });
  await page.send('Input.insertText', { text: '》' });
  await until(() => page.evaluate(`!${EDITOR}.view.composing`), '标点提交');
  await typeKeys(page, ' ');
  await compose(page, 'yin yong', '引用');
  await until(() => page.evaluate(`!${EDITOR}.view.composing`), '正文提交');
  assert.equal(await page.evaluate(TYPES), '["blockquote","paragraph"]', '全角 》 加空格是引用');
  assert.equal(await page.evaluate(`${EDITOR}.getText().trim()`), '引用');
  await typeKeys(page, '，a > b 且 <批名>');
  await until(() => app.state.notes.readBody(app.state.notes.require(quoted)).includes('批名'), '保存');
  assert.equal(app.state.notes.readBody(app.state.notes.require(quoted)).trim(), '> 引用，a > b 且 <批名>',
    '存下来的是平常的字，不是 &gt; &lt;');

  await open(page, app, '');
  await page.evaluate(`(() => { const data = new DataTransfer();
    data.setData('text/plain', '# 标题\\n\\n- 一项\\n- 两项\\n\\n> 引用\\n\\n**粗** 和 [链接](https://example.com)');
    ${EDITOR}.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true,
      cancelable: true })); })()`);
  assert.match(await page.evaluate<string>(TYPES), /^\["heading1","bulletList","blockquote","paragraph"/);
  await page.evaluate(`${EDITOR}.commands.selectAll()`);
  const copied = await page.evaluate<string>(`(() => { const data = new DataTransfer();
    ${EDITOR}.view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true,
      cancelable: true }));
    return data.getData('text/plain'); })()`);
  assert.equal(copied, '# 标题\n\n- 一项\n- 两项\n\n> 引用\n\n**粗** 和 [链接](https://example.com)');
  await page.evaluate(`${EDITOR}.commands.undo()`);
  assert.equal(await page.evaluate(`${EDITOR}.getText().trim()`), '', '撤销一步回到粘贴前');
});

test('续写的接受和忽略：Tab 收下后撤销重做各一步；Esc 忽略不进正文也不进撤销记录', async (t) => {
  const { app, page } = await start(t, ['，然后把事实记清楚。', '，这一条会被忽略。']);
  const id = await open(page, app, '正在记录这段经历');
  await until(() => page.evaluate(`${GHOST} === '，然后把事实记清楚。'`), '灰字出现');
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '正在记录这段经历', '没接受的建议不在正文里');
  await key(page, 'Tab', 9);
  await until(() => page.evaluate(`${EDITOR}.getText() === '正在记录这段经历，然后把事实记清楚。'`), 'Tab 收下');
  await page.evaluate(`${EDITOR}.commands.undo()`);
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '正在记录这段经历', '撤销一步，收下的整句都撤掉');
  await page.evaluate(`${EDITOR}.commands.redo()`);
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '正在记录这段经历，然后把事实记清楚。');
  await until(() => app.state.notes.readBody(app.state.notes.require(id)).includes('记清楚'), '保存');
  await until(() => page.evaluate(`${GHOST} === '，这一条会被忽略。'`), '第二条灰字');
  await key(page, 'Escape', 27);
  await until(() => page.evaluate(`${GHOST} === null`), 'Esc 收起');
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '正在记录这段经历，然后把事实记清楚。');
  await page.evaluate(`${EDITOR}.commands.undo()`);
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '正在记录这段经历', '忽略没有留下撤销记录');
});

test('快速切换笔记：上一篇迟到的续写不出现在下一篇；续写请求失败不影响打字和保存', async (t) => {
  const slow = Promise.withResolvers<void>();
  const { app, page } = await start(t, [async () => {
    await slow.promise;
    return { text: '这是给第一篇的续写', complete: true };
  }, () => { throw new Error('模型通道断了'); }, '，第三次才给出来。']);
  t.after(() => slow.resolve());
  await open(page, app, '第一篇写到这里停下');
  await until(() => app.requests.length === 1, '第一篇的续写请求发出');
  const second = await open(page, app, '第二篇是另一件事情');
  slow.resolve();
  await pause(400);
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '第二篇是另一件事情');
  assert.notEqual(await page.evaluate(GHOST), '这是给第一篇的续写', '迟到的续写不串到这一篇');
  await until(() => app.requests.length >= 2, '第二篇自己要了一次（这次失败）');
  await pause(300);
  await compose(page, 'jie zhe xie', '接着写');
  await until(() => page.evaluate(`!${EDITOR}.view.composing`), '组字提交');
  assert.equal(await page.evaluate(`${EDITOR}.getText()`), '第二篇是另一件事情接着写', '请求失败时打的字一个不少');
  await until(() => app.state.notes.readBody(app.state.notes.require(second)).includes('接着写'), '照常保存');
  await until(() => page.evaluate(`${GHOST} === '，第三次才给出来。'`), '下一次停笔重新要到续写');
});

// 11-12 Aaron 在 Mac 客户端 + 第三方输入法上复现并给了输入诊断：光标在文字中间组字时按退格删掉一个拼音字母，
// ProseMirror 把这次 DOM 变化当成「像是按了退格」，补发一个退格键给各个键位表；TipTap 的键位处理不管成没成都发一个
// 空事务，空事务让视图在正文还没跟上 DOM 的时候重画了正在组的那段字，组字被打断，剩下的拼音留在正文里。
for (const [where, position] of [['文字中间', 9], ['段尾', 18]] as const) {
  test(`组字中按退格删拼音（${where}）：组字不被打断，选字后正文里没有残留的拼音`, async (t) => {
    const { app, page } = await start(t, Array.from({ length: 20 }, () => ''));
    const id = await open(page, app, '前半句已经写好，后半句也已经写好。');
    await page.evaluate(`(() => { window.ends = []; window.odd = 0;
      ${EDITOR}.view.dom.addEventListener('compositionend', (event) => window.ends.push(event.data));
      ${EDITOR}.on('transaction', ({ transaction }) => {
        if (${EDITOR}.view.composing && !transaction.docChanged && !transaction.selectionSet) window.odd += 1; }); })(); 0`);
    await page.evaluate(`${EDITOR}.chain().focus().setTextSelection(${position}).run()`);
    await pause(250);
    for (const text of ['n', 'ni', 'nih', 'niha', 'nihao', 'niha', 'nih', 'niha', 'nihao']) {
      await page.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await pause(60);
    }
    assert.equal(await page.evaluate(`${EDITOR}.view.composing`), true, '删了两个字母以后还在组字');
    assert.deepEqual(await page.evaluate('window.ends'), [], '组字没有被提前结束');
    assert.equal(await page.evaluate('window.odd'), 0, '组字期间没有空事务');
    await page.send('Input.insertText', { text: '你好' });
    await until(() => page.evaluate(`!${EDITOR}.view.composing`), '选字提交');
    const expected = position === 9 ? '前半句已经写好，你好后半句也已经写好。' : '前半句已经写好，后半句也已经写好。你好';
    assert.equal(await page.evaluate(`${EDITOR}.getText()`), expected);
    await until(() => app.state.notes.readBody(app.state.notes.require(id)).trim() === expected, '保存的也是选好的字');
  });
}
