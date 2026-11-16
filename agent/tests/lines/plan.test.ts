// 线自己的步骤清单（line_plan，11-16）：整份给、做一步勾一步，界面的线视图带着；同时只能一步在做，空的清掉。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { startKernel } from './helpers.ts';

const STEPS = [{ text: '打开消息页', status: 'done' }, { text: '打招呼 · 37 / 200', status: 'running' },
  { text: '整理成表', status: 'todo' }];

test('line_plan：列的步骤进线视图，推给界面；两步同时在做不收；给空的清掉', async () => {
  const h = await startKernel();
  try {
    h.respond([
      fauxAssistantMessage([fauxToolCall('line_plan', { steps: STEPS }, { id: 'p1' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxToolCall('line_plan', { steps: [{ text: 'a', status: 'running' },
        { text: 'b', status: 'running' }] }, { id: 'p2' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage('列好了'),
    ]);
    h.kernel.tell(MAIN_LINE_ID, '海投');
    await h.kernel.settled();
    assert.deepEqual(h.kernel.view(MAIN_LINE_ID).plan, STEPS);
    const results = h.kernel.read(MAIN_LINE_ID, 20).messages.filter((message) => message.role === 'toolResult');
    assert.equal(results[0]?.ok, true);
    assert.equal(results[1]?.ok, false);
    h.respond([fauxAssistantMessage([fauxToolCall('line_plan', { steps: [] }, { id: 'p3' })],
      { stopReason: 'toolUse' }), fauxAssistantMessage('清掉了')]);
    h.kernel.tell(MAIN_LINE_ID, '不用清单了');
    await h.kernel.settled();
    assert.equal(h.kernel.view(MAIN_LINE_ID).plan, null);
  } finally { await h.close(); }
});
