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

test('fill and type record latest inserted text as draft, including selector-based fill', () => {
  assert.deepEqual(trace([fill('第一版'), fill('第二版')]), { url: null, filled: '第二版', unverifiedPaste: false });
  assert.equal(trace([row('tab_type', { text: '打进去的字' })]).filled, '打进去的字');
  assert.equal(trace([row('tab_fill', { selector: '#box', value: '按选择器填的' })]).filled, '按选择器填的');
});

test('paste without readback does not reuse prior cleared fill and marks unverified', () => {
  assert.deepEqual(trace([fill(''), paste('正文')]), { url: null, filled: null, unverifiedPaste: true });
});

test('full readback from start after paste identifies pasted text from page content', () => {
  const got = trace([fill(''), paste('正文'), read('导航\n正文\n保存')]);
  assert.deepEqual(got, { url: PAGE, filled: '正文', unverifiedPaste: false });
});

test('multi-chunk paste counts as one full body returning exact page whitespace and newlines', () => {
  const got = trace([fill(''), paste('甲'), paste('乙'), paste('丙'), paste('丁'), read('导航\n甲\n乙\n\n丙 丁\n保存')]);
  assert.equal(got.filled, '甲\n乙\n\n丙 丁');
  assert.equal(got.unverifiedPaste, false);
});

test('text filled before paste is prepended when verifying combined content', () => {
  assert.equal(trace([fill('标题：'), paste('正文'), read('标题：正文')]).filled, '标题：正文');
});

test('long page requires reading chunks until nextOffset is null before verification succeeds', () => {
  const partly = trace([paste('很长的正文'), read('导航\n很长的', 0, 6)]);
  assert.equal(partly.unverifiedPaste, true);
  const whole = trace([paste('很长的正文'), read('导航\n很长的', 0, 6), read('正文\n保存', 6, null)]);
  assert.deepEqual(whole, { url: PAGE, filled: '很长的正文', unverifiedPaste: false });
});

test('skipping chunks or not starting from offset 0 does not complete readback', () => {
  assert.equal(trace([paste('正文'), read('正文', 5, null)]).unverifiedPaste, true);
  assert.equal(trace([paste('很长的正文'), read('导航\n很长的', 0, 6), read('正文', 9, null)]).unverifiedPaste, true);
});

test('page mutation mid-readback invalidates sequence and requires reading from start', () => {
  const rows = [paste('很长的正文'), read('导航\n很长的', 0, 6), row('tab_click', { selector: '#b', text: null }),
    read('正文\n保存', 6, null)];
  assert.equal(trace(rows).unverifiedPaste, true);
  assert.equal(trace([...rows, read('导航\n很长的正文\n保存')]).filled, '很长的正文');
});

test('missing text or duplicate occurrences on page fail paste verification', () => {
  assert.equal(trace([fill(''), paste('完整正文'), read('完整错文')]).unverifiedPaste, true);
  assert.equal(trace([fill(''), paste('内容'), read('内容 内容')]).unverifiedPaste, true);
  assert.equal(pastedOnPage('随便什么', ['  ']), null);
});

test('keypress after paste invalidates draft state until page is read back again', () => {
  const rows = [paste('正文'), read('正文'), row('tab_key', { key: 'Backspace' })];
  assert.deepEqual(trace(rows), { url: PAGE, filled: null, unverifiedPaste: true });
  assert.equal(trace([...rows, read('正')]).unverifiedPaste, true);
  assert.equal(trace([...rows, read('正文')]).filled, '正文');
});

test('reads on another tab or failed pastes do not affect current tab verification', () => {
  assert.equal(trace([paste('正文'), row('tab_read', { tabId: 'other' }, { text: '正文', offset: 0, nextOffset: null })])
    .unverifiedPaste, true);
  assert.equal(trace([fill('旧的'), row('tab_paste', { text: '新的' }, {}, 'failed')]).filled, '旧的');
});

test('new fill or URL navigation clears previous paste verification state', () => {
  assert.deepEqual(trace([paste('正文'), fill('新的')]), { url: null, filled: '新的', unverifiedPaste: false });
  assert.deepEqual(trace([fill('旧的'), paste('正文'), row('tab_navigate', { url: PAGE })]),
    { url: null, filled: null, unverifiedPaste: false });
});

test('key, paste, upload, drag, or dialog after send-block clears it; read/shot/scroll preserve it', () => {
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

test('every tab_ action is classified; non-tab actions do not count as page mutations', () => {
  const tabKinds = DEVICE_ACTION_KINDS.filter((kind) => kind.startsWith('tab_'));
  assert.ok(tabKinds.length >= 22);
  assert.equal(changesTab('input_click'), false);
  assert.equal(changesTab('没有这种'), false);
});

test('page_send blocks unverified paste and requires send text to match verified readback', async () => {
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
  await assert.rejects(verified.execute(args, context), failure(/没有经过授权核对/));
});
