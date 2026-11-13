// 真实消息 API、SSE 和浏览器选区：委派不冒充本人；任务完成不换卡；鼠标/手机异步单字引用不丢草稿。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID } from '../../agent/src/state/index.ts';
import { userMessage } from '../../agent/src/lines/messages.ts';
import type { Cdp } from '../../scripts/browser/cdp.ts';
import { capture, click, fill, startStack, until } from './helpers.ts';
import { reloadPage } from './reload.ts';

const REPLY = '引用只带选中的原文，输入框里的草稿会保留。';
const DRAFT = '再解释这一句';
const SOURCE = `.line-answer .markdown p`;

async function selectReply(page: Cdp, phone: boolean): Promise<string> {
  const end = phone ? 1 : 4;
  const selected = REPLY.slice(0, end);
  const rect = await page.evaluate<{ left: number; right: number; y: number }>(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(SOURCE)})]
      .find(node => node.textContent === ${JSON.stringify(REPLY)});
    node.scrollIntoView({ block: 'center' });
    const range = document.createRange();
    range.setStart(node.firstChild, 0);
    range.setEnd(node.firstChild, ${end});
    const box = range.getBoundingClientRect();
    return { left: box.left, right: box.right, y: box.top + box.height / 2 };
  })()`);
  if (phone) {
    // 原生长按菜单先结束触摸，随后才提交选区；浏览器自己发 selectionchange，不补发 mouseup。
    await page.evaluate(`(async () => {
      const node = [...document.querySelectorAll(${JSON.stringify(SOURCE)})]
        .find(node => node.textContent === ${JSON.stringify(REPLY)});
      node.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const range = document.createRange();
      range.setStart(node.firstChild, 0);
      range.setEnd(node.firstChild, 1);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    })()`);
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.left, y: rect.y,
      button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.right, y: rect.y,
      button: 'left', buttons: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.right, y: rect.y,
      button: 'left', buttons: 0, clickCount: 1 });
  }
  await until(page, `document.querySelector('.quote-action:not([hidden])')`, '选文引用操作');
  assert.equal(await page.evaluate('getSelection().toString()'), selected);
  const hit = await page.evaluate<boolean>(`(() => {
    const button = document.querySelector('.quote-action:not([hidden])');
    const box = button.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
      && button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  })()`);
  assert.equal(hit, true, '引用操作没有被输入框或滚动边缘遮住');
  return selected;
}

for (const client of ['mac', 'phone'] as const) {
  test(`${client}：来源、稳定任务卡和选文引用走真实接口，保留草稿和发送原文`, async (t) => {
    const { app, page } = await startStack(t, { kernel: { connected: true }, client,
      realClock: true, hash: '/messages/plasticine' });
    const state = app.state;
    state.lines.main();
    const stamp = app.clock.now().getTime();
    state.lineMessages.append(MAIN_LINE_ID, 'user', userMessage('核对消息顺序', [], stamp),
      { origin: { kind: 'user', userText: '核对消息顺序' } });
    const intro = state.lineMessages.append(MAIN_LINE_ID, 'assistant', fauxAssistantMessage([
      { type: 'text', text: '我先核对记录，再继续回答。' },
      fauxToolCall('start_line', { title: '核对记录', goal: '逐条核对记录' }, { id: 'start-check' }),
    ], { stopReason: 'toolUse' }));
    const child = state.lines.create({ kind: 'background', parentLineId: MAIN_LINE_ID,
      projectId: null, title: '核对记录' });
    state.lineMessages.append(child.id, 'user', userMessage('逐条核对记录', [], stamp),
      { origin: { kind: 'delegation', ref: `line:${MAIN_LINE_ID}:${intro.seq}` } });
    state.lines.update(child.id, { status: 'running' });
    state.lineMessages.append(MAIN_LINE_ID, 'toolResult', { role: 'toolResult', toolCallId: 'start-check',
      toolName: 'start_line', content: [{ type: 'text', text: '已开始' }], isError: false, timestamp: stamp });
    state.lineMessages.append(MAIN_LINE_ID, 'assistant', fauxAssistantMessage(REPLY));
    state.lineMessages.append(MAIN_LINE_ID, 'user', userMessage('继续检查选文', [], stamp),
      { origin: { kind: 'delegation' } });
    await reloadPage(page);
    await until(page, `document.querySelector('.line-input-record')`, '委派记录');
    assert.equal(await page.evaluate(`document.querySelectorAll('.line-scroll .msg-user').length`), 1);
    assert.equal(await page.evaluate(`document.querySelector('.line-input-record').open`), false);
    await page.evaluate(`void (window.__card = document.querySelector('.line-card'));`);
    const before = await page.evaluate<string[]>(`Array.from(document.querySelectorAll('.line-item'))
      .map(node => node.dataset.kind)`);
    assert.deepEqual(before, ['user', 'turn', 'child', 'turn', 'input']);

    app.clock.advance(1000);
    state.lineMessages.append(child.id, 'assistant', fauxAssistantMessage('核对完成。'));
    state.lines.update(child.id, { status: 'idle' });
    const report = state.lineMessages.append(MAIN_LINE_ID, 'lineReport', { role: 'lineReport', lineId: child.id,
      title: child.title, outcome: 'done', text: '核对完成。', timestamp: app.clock.now().getTime() });
    app.app.deps.hub.publish({ type: 'line_changed', line: app.app.deps.lines.view(child.id) });
    const projected = app.app.deps.lines.read('main', 50).messages.find((message) => message.seq === report.seq)!;
    app.app.deps.hub.publish({ type: 'line_message', message: projected });
    await until(page, `document.querySelector('[data-kind="report"]')`, '后台回报');
    assert.equal(await page.evaluate(`window.__card === document.querySelector('.line-card')`), true);
    assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.line-item'))
      .map(node => node.dataset.kind)`),
      [...before, 'report']);

    await fill(page, 'textarea[aria-label="问一句"]', DRAFT);
    const selected = await selectReply(page, client === 'phone');
    await capture(page, `line-selection-${client}`);
    await click(page, '引用到对话');
    await until(page, `document.querySelector('.line-quotes pre')`, '输入框引用片');
    assert.equal(await page.evaluate(`document.querySelector('.line-quotes pre').textContent`), selected);
    assert.equal(await page.evaluate(`document.querySelector('.line-input').value`), DRAFT);
    assert.equal(await page.evaluate(`document.activeElement === document.querySelector('.line-input')`), true);
    await capture(page, `line-quote-compose-${client}`);
    await click(page, '发送');
    await until(page, `!document.querySelector('.line-quotes')`, '引用与草稿已发送');
    await app.app.deps.lines.settled();
    const own = app.app.deps.lines.read('main', 50).messages.findLast((message) => message.origin?.kind === 'user');
    assert.ok(own?.text.includes(selected));
    assert.ok(own.text.endsWith(DRAFT));
    assert.equal(own.origin?.userText, DRAFT, '引用没有变成用户原话');
    await reloadPage(page);
    await until(page, `document.querySelector('.line-scroll .quote-preview')`, '刷新后引用原文仍在');
    assert.equal(await page.evaluate(`document.querySelector('.line-scroll .quote-preview pre').textContent`),
      selected);
  });
}
