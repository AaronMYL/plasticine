// 笔记「引用到对话」在真服务端 + 新内核（线）上：引用片固定点下去时的那一版全文（别处后来改了也不换），发出去的消息里是
// 完整的那一版（连末尾）；手机上主线的记录里能展开引用、在框里滚到底，刷新后照样，不重复调模型。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { splitQuotes } from '../src/api/quote-text.ts';
import { capture, click, fill, key, settle, size, startStack, until } from './helpers.ts';
import { reloadPage } from './reload.ts';

test('笔记引用固定点下去时的那一版和完整末尾，手机上能展开滚动，刷新后范围仍准确', async (t) => {
  const paragraphs = Array.from({ length: 48 }, (_, index) => `第 ${index + 1} 段：保留具体事实，分清观察与推测。`);
  const markdown = `# 普通用户的长笔记\n\n${paragraphs.join('\n\n')}\n\n全文最后证据：完整保留这一句。`;
  const stack = await startStack(t, { kernel: { connected: true }, realClock: true, hash: '/today' });
  const { app, page, kernel } = stack;
  assert.ok(kernel !== null);
  const note = app.state.notes.create({ markdown, author: 'user', folder: '笔记' });
  await page.evaluate(`location.hash = ${JSON.stringify(`#/notes/${note.id}`)}`);
  await until(page, `document.querySelector('.note-body .ProseMirror')`, '打开长笔记');
  await click(page, '引用到对话');
  await until(page, `document.querySelector('.line-quotes .quote-preview')`, '全文引用片');
  assert.equal(await page.evaluate(`document.querySelector('.line-quotes pre').textContent`), markdown);
  assert.equal(await page.evaluate(`document.querySelector('.line-quotes').textContent.includes('全文')`), true);
  await capture(page, 'note-quote-compose-desktop');

  // 另一台设备在引用之后改了这篇：发出去的仍是点下去时的那一版。
  app.state.notes.save(note.id, note.version, { markdown: '# 已修改\n新版正文不能替换选定版本。' });
  await fill(page, 'textarea[aria-label="问一句"]', '请根据这一版全文回答');
  await page.evaluate(`document.querySelector('textarea[aria-label="问一句"]').focus()`);
  await key(page, 'Enter');
  await settle(() => kernel.providers.oauth.state.callCount === 1, '模型收到一次请求');
  const lines = app.app.deps.lines;
  assert.ok(lines !== undefined);
  const user = lines.read('main', 10).messages.find((message) => message.role === 'user');
  assert.ok(user !== undefined);
  assert.ok(user.text.includes('全文最后证据：完整保留这一句。'));
  assert.ok(!user.text.includes('新版正文不能替换选定版本'));
  const quote = splitQuotes(user.text, 'stored').quotes[0];
  assert.equal(quote?.text, markdown);
  assert.deepEqual(quote?.noteReference, { noteId: note.id, version: note.version, scope: 'full' });

  await size(page, 390, 844);
  await page.evaluate(`location.hash = '#/messages/plasticine'`);
  const preview = `document.querySelector('.line-scroll .msg-user .quote-preview')`;
  await until(page, `${preview}?.querySelector('summary')`, '手机上记录里的引用');
  await page.evaluate(`${preview}.querySelector('summary').click()`);
  await until(page, `${preview}.querySelector('details')?.open`, '手机展开原文');
  type Metrics = { overflow: boolean; scrollable: boolean; text: string; bottom: number };
  const metrics = await page.evaluate<Metrics>(`(() => {
    const pre = ${preview}.querySelector('pre');
    pre.scrollTop = pre.scrollHeight;
    return { overflow: document.documentElement.scrollWidth > innerWidth
      || pre.getBoundingClientRect().right > innerWidth,
      scrollable: pre.scrollHeight > pre.clientHeight && pre.clientHeight > 0,
      text: pre.textContent, bottom: pre.scrollTop };
  })()`);
  assert.equal(metrics.overflow, false);
  assert.equal(metrics.scrollable, true);
  assert.ok(metrics.bottom > 0);
  assert.equal(metrics.text, markdown);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await pause(80);
    await capture(page, `note-quote-history-mobile-${theme}`);
  }
  await reloadPage(page);
  await until(page, preview, '刷新恢复记录');
  assert.equal(await page.evaluate(`${preview}.querySelector('pre').textContent`), markdown);
  assert.equal(await page.evaluate(`${preview}.textContent.includes('版本 1')`), true);
  assert.equal(kernel.providers.oauth.state.callCount, 1, '刷新只读记录，不重复调模型');
});
