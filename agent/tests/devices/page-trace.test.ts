// 发送的门核「填进去的是什么」（devices/page-trace.ts）：填、打字照原文算；粘贴进去的要从头读完这一页、在正文里找到
// 全文才算数，不拿之前填的或最后一段顶替。拦下以后又按键、粘贴、上传、拖动、答弹框，那次拦下不再作数。

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DEVICE_ACTION_KINDS, type NodeAction } from '../../shared/state.ts';
import { createPageSendTool } from '../../src/devices/page-send.ts';
import { changedSinceHold, type SubmitHold } from '../../src/devices/page-submits.ts';
import { changesTab, pastedOnPage, tabTrace } from '../../src/devices/page-trace.ts';
import { ToolFailure } from '../../src/tools/index.ts';

const TAB = 'tab-1';
const PAGE = 'https://editor.example.com/draft';

function row(kind: string, more: Record<string, unknown> = {}, result: unknown = {}, status = 'executed'): NodeAction {
  return { kind, status, actionId: randomUUID(), envelope: { action: { kind, tabId: TAB, ...more } },
    result } as unknown as NodeAction;
}

const fill = (value: string): NodeAction => row('tab_act', { act: { op: 'fill', n: 1, value } });
const paste = (text: string): NodeAction => row('tab_paste', { text, html: null });
const read = (text: string, offset = 0, nextOffset: number | null = null): NodeAction =>
  row('tab_read', { offset }, { text, offset, nextOffset, url: PAGE });

type TraceState = Parameters<typeof tabTrace>[0];
type SendState = Parameters<typeof createPageSendTool>[0];
const stateOf = (rows: NodeAction[]): TraceState =>
  ({ nodeActions: { forRunNode: () => rows } }) as unknown as TraceState;
const trace = (rows: NodeAction[]): ReturnType<typeof tabTrace> => tabTrace(stateOf(rows), 'line:x', 'node', TAB);

test('填和打字：最近放进去的那段就是原文，按选择器填的也算', () => {
  assert.deepEqual(trace([fill('第一版'), fill('第二版')]), { url: null, filled: '第二版', unverifiedPaste: false });
  assert.equal(trace([row('tab_type', { text: '打进去的字' })]).filled, '打进去的字');
  assert.equal(trace([row('tab_fill', { selector: '#box', value: '按选择器填的' })]).filled, '按选择器填的');
});

test('粘贴以后没回读：不拿之前清空的那次填写当原文，标成还没核对', () => {
  assert.deepEqual(trace([fill(''), paste('正文')]), { url: null, filled: null, unverifiedPaste: true });
});

test('粘贴后从头读完这一页：正文里找到的那段就是原文', () => {
  const got = trace([fill(''), paste('正文'), read('导航\n正文\n保存')]);
  assert.deepEqual(got, { url: PAGE, filled: '正文', unverifiedPaste: false });
});

test('分几段粘贴算一整篇，不是最后一段；回的是页面上的原样文字（换行和空格照页面）', () => {
  const got = trace([fill(''), paste('甲'), paste('乙'), paste('丙'), paste('丁'), read('导航\n甲\n乙\n\n丙 丁\n保存')]);
  assert.equal(got.filled, '甲\n乙\n\n丙 丁');
  assert.equal(got.unverifiedPaste, false);
});

test('粘贴之前填着的字排在最前面一起核', () => {
  assert.equal(trace([fill('标题：'), paste('正文'), read('标题：正文')]).filled, '标题：正文');
});

test('长页面分几段接着读，读到 nextOffset 是 null 才核对', () => {
  const partly = trace([paste('很长的正文'), read('导航\n很长的', 0, 6)]);
  assert.equal(partly.unverifiedPaste, true);
  const whole = trace([paste('很长的正文'), read('导航\n很长的', 0, 6), read('正文\n保存', 6, null)]);
  assert.deepEqual(whole, { url: PAGE, filled: '很长的正文', unverifiedPaste: false });
});

test('跳着读、没从头读的不算读完', () => {
  assert.equal(trace([paste('正文'), read('正文', 5, null)]).unverifiedPaste, true);
  assert.equal(trace([paste('很长的正文'), read('导航\n很长的', 0, 6), read('正文', 9, null)]).unverifiedPaste, true);
});

test('读到一半页面又被改过：那一串不作数，要从头再读', () => {
  const rows = [paste('很长的正文'), read('导航\n很长的', 0, 6), row('tab_click', { selector: '#b', text: null }),
    read('正文\n保存', 6, null)];
  assert.equal(trace(rows).unverifiedPaste, true);
  assert.equal(trace([...rows, read('导航\n很长的正文\n保存')]).filled, '很长的正文');
});

test('页面上找不到、或者同样的字有两处：核对不上', () => {
  assert.equal(trace([fill(''), paste('完整正文'), read('完整错文')]).unverifiedPaste, true);
  assert.equal(trace([fill(''), paste('内容'), read('内容 内容')]).unverifiedPaste, true);
  assert.equal(pastedOnPage('随便什么', ['  ']), null);
});

test('粘贴后按过键：输入框里是什么算不出来，重新回读才算数', () => {
  const rows = [paste('正文'), read('正文'), row('tab_key', { key: 'Backspace' })];
  assert.deepEqual(trace(rows), { url: PAGE, filled: null, unverifiedPaste: true });
  assert.equal(trace([...rows, read('正')]).unverifiedPaste, true);
  assert.equal(trace([...rows, read('正文')]).filled, '正文');
});

test('别的标签上的读、没做成的粘贴都不算', () => {
  assert.equal(trace([paste('正文'), row('tab_read', { tabId: 'other' }, { text: '正文', offset: 0, nextOffset: null })])
    .unverifiedPaste, true);
  assert.equal(trace([fill('旧的'), row('tab_paste', { text: '新的' }, {}, 'failed')]).filled, '旧的');
});

test('重新填一次、换了地址：之前粘贴的不再算', () => {
  assert.deepEqual(trace([paste('正文'), fill('新的')]), { url: null, filled: '新的', unverifiedPaste: false });
  assert.deepEqual(trace([fill('旧的'), paste('正文'), row('tab_navigate', { url: PAGE })]),
    { url: null, filled: null, unverifiedPaste: false });
});

test('拦下以后又按键、粘贴、上传、拖动、答弹框：那次拦下不再作数；只是读、截图、滚动不影响', () => {
  const held = row('tab_act', { version: 'v', act: { op: 'click', n: 2 }, submitAsk: null });
  const hold: SubmitHold = { actionId: held.actionId, tabId: TAB, version: 'v', n: 2, op: 'click', kind: 'publish',
    label: '发送' };
  const changed = (kind: string): boolean => changedSinceHold(stateOf([held, row(kind)]), 'line:x', 'node', hold);
  for (const kind of ['tab_key', 'tab_paste', 'tab_upload', 'tab_drag', 'tab_dialog', 'tab_type', 'tab_navigate']) {
    assert.equal(changed(kind), true, kind);
  }
  for (const kind of ['tab_read', 'tab_shot', 'tab_scroll', 'tab_hover', 'tab_wait', 'tab_perceive']) {
    assert.equal(changed(kind), false, kind);
  }
});

test('每一种 tab_ 动作都表了态；不是网页标签的动作不算改页面', () => {
  const tabKinds = DEVICE_ACTION_KINDS.filter((kind) => kind.startsWith('tab_'));
  assert.ok(tabKinds.length >= 22);
  assert.equal(changesTab('input_click'), false);
  assert.equal(changesTab('没有这种'), false);
});

test('page_send：粘贴没核对上不发；核对上以后要发的原文必须和读回来的一样', async () => {
  const held = row('tab_act', { version: 'v', act: { op: 'click', n: 2 }, step: '点保存', submitAsk: null },
    { errorCode: 'submit_needs_you', submit: { kind: 'submit', label: '保存为草稿' },
      target: { n: 2, role: 'button', name: '保存为草稿' } }, 'failed');
  const never = { submitRefusal: () => null, screen: () => null,
    perform: () => Promise.reject(new Error('不该发到设备')) };
  const toolFor = (rows: NodeAction[]): ReturnType<typeof createPageSendTool> => createPageSendTool(
    { ...stateOf(rows), outboundLog: { forCall: () => undefined } } as unknown as SendState, never);
  const args = { nodeId: 'node', tabId: TAB, version: 'v', site: 'editor.example.com', to: '自己的草稿箱',
    text: '甲\n乙' };
  const context = { runId: 'line:x', callId: 'call', actionId: 'line:x:call',
    signal: new AbortController().signal } as Parameters<ReturnType<typeof createPageSendTool>['execute']>[1];
  const failure = (pattern: RegExp) => (error: unknown): boolean =>
    error instanceof ToolFailure && pattern.test(error.content);

  const unread = toolFor([fill(''), paste('甲'), paste('乙'), row('tab_perceive', {}, { url: PAGE }), held]);
  await assert.rejects(unread.execute(args, context), failure(/还没有回读核对/));

  const verified = toolFor([fill(''), paste('甲'), paste('乙'), read('导航\n甲\n乙\n保存'), held]);
  await assert.rejects(verified.execute({ ...args, text: '乙' }, context), failure(/原文不一样/));
  // 原文对上了，下一关是授权核对（这里没有发送记录）：说明粘贴这一关过了。
  await assert.rejects(verified.execute(args, context), failure(/没有经过授权核对/));
});
