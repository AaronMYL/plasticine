// 较早的「看一眼」和旧图不留在上下文里（内核优化第一批，11-17）：界线按批往前推；库里的消息一条不改。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type ToolResultMessage, type TranscriptContext }
  from '@earendil-works/pi-ai';
import { collapseStale, isSnapshotCall, STALE_IMAGE_NOTE, STALE_KEEP_MESSAGES, STALE_SNAPSHOT_NOTE,
  STALE_STEP_MESSAGES, staleBoundary } from '../../src/lines/stale-results.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { echoTool, startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

function result(parts: ToolResultMessage['content']): ToolResultMessage {
  return { role: 'toolResult', toolCallId: 'call-1', toolName: 'device_action', content: parts, isError: false,
    timestamp: 1 };
}

test('哪些调用算「看一眼」：读线、设备和云端浏览器的状态、device_action 里看页面的动作；读正文和动手的不算', () => {
  assert.ok(isSnapshotCall({ name: 'read_line', arguments: { lineId: 'line-a' } }));
  assert.ok(isSnapshotCall({ name: 'cloud_browser_observe', arguments: {} }));
  assert.ok(isSnapshotCall({ name: 'device_action', arguments: { action: { kind: 'tab_perceive', tabId: 't1' } } }));
  assert.ok(isSnapshotCall({ name: 'device_action', arguments: { action: { kind: 'screen_capture' } } }));
  assert.ok(!isSnapshotCall({ name: 'device_action', arguments: { action: { kind: 'tab_read', tabId: 't1' } } }));
  assert.ok(!isSnapshotCall({ name: 'device_action', arguments: { action: { kind: 'tab_act', tabId: 't1' } } }));
  assert.ok(!isSnapshotCall({ name: 'read_result', arguments: { ref: 'line:a:1' } }));
  assert.ok(!isSnapshotCall({ name: 'device_action', arguments: {} }));
});

test('界线按批往前推：最近的留着，每多一批才动一次', () => {
  assert.equal(staleBoundary(0), 0);
  assert.equal(staleBoundary(STALE_KEEP_MESSAGES + STALE_STEP_MESSAGES - 1), 0, '还没攒够一批');
  assert.equal(staleBoundary(STALE_KEEP_MESSAGES + STALE_STEP_MESSAGES), STALE_STEP_MESSAGES);
  assert.equal(staleBoundary(STALE_KEEP_MESSAGES + STALE_STEP_MESSAGES + 5), STALE_STEP_MESSAGES, '同一批里不动');
  assert.equal(staleBoundary(STALE_KEEP_MESSAGES + 2 * STALE_STEP_MESSAGES), 2 * STALE_STEP_MESSAGES);
});

test('界线之内：「看一眼」整个换成一行；别的结果只收图、文字原样；界线之外原样', () => {
  const perceive = { name: 'device_action', arguments: { action: { kind: 'tab_perceive', tabId: 't1' } } };
  const act = { name: 'device_action', arguments: { action: { kind: 'tab_act', tabId: 't1' } } };
  const page = result([{ type: 'text', text: '很长的页面结构' }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }]);
  assert.deepEqual(collapseStale(page, perceive, 40, 40).content, [{ type: 'text', text: STALE_SNAPSHOT_NOTE }]);
  assert.equal(collapseStale(page, perceive, 41, 40), page, '界线之外原样');
  assert.deepEqual(collapseStale(page, act, 10, 40).content,
    [{ type: 'text', text: '很长的页面结构' }, { type: 'text', text: STALE_IMAGE_NOTE }]);
  const plain = result([{ type: 'text', text: '点好了' }]);
  assert.equal(collapseStale(plain, act, 10, 40), plain, '没有图的动手结果不动');
  assert.deepEqual(collapseStale(page, undefined, 10, 40).content,
    [{ type: 'text', text: '很长的页面结构' }, { type: 'text', text: STALE_IMAGE_NOTE }], '对不上调用的只收图');
});

function toolTexts(context: TranscriptContext): string[] {
  return context.messages.flatMap((message) => (message.role === 'toolResult'
    ? [message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')] : []));
}

test('一条线跑长了：送给模型的上下文里较早的列线结果收成一行，最近的原样；库里的一条不改', async () => {
  const h = await startKernel({ tools: [echoTool()] });
  open.push(h);
  // 每一步一条回答加一条结果；连同开头那句话，跑到第 36 步时库里超过 70 条，界线推到 40。
  const steps = 36;
  let seen: string[] = [];
  h.respond([
    ...Array.from({ length: steps }, () => fauxAssistantMessage([fauxToolCall('list_lines', {})],
      { stopReason: 'toolUse' as const })),
    (context) => {
      seen = toolTexts(context);
      return fauxAssistantMessage('看完了。');
    },
  ]);
  h.kernel.send('main', { text: '一直看着后台的事' });
  await h.kernel.settled();
  assert.equal(seen.length, steps);
  const collapsed = seen.filter((text) => text === STALE_SNAPSHOT_NOTE).length;
  // 界线 40：seq 3、5、……、39 这 19 条结果在界线之内。
  assert.equal(collapsed, 19);
  assert.ok(!seen.slice(collapsed).some((text) => text === STALE_SNAPSHOT_NOTE), '界线之后的原样');
  const stored = h.handle.state.lineMessages.after(MAIN_LINE_ID, 0)
    .filter((row) => row.role === 'toolResult').map((row) => JSON.stringify(row.message));
  assert.ok(!stored.some((text) => text.includes(STALE_SNAPSHOT_NOTE)), '库里的结果原样');
});
