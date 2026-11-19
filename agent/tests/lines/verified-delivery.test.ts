import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineView, NO_ACTIVITY } from '../../src/lines/views.ts';
import { openTestState } from '../state/helpers.ts';

test('运维核实的已送达结果只对同一任务、同一行版本和同一消息序号生效', async () => {
  const handle = await openTestState();
  const { state } = handle;
  try {
    const line = state.lines.create({ kind: 'background', title: '测试提醒', parentLineId: null, projectId: null });
    const tail = state.lineMessages.append(line.id, 'toolResult', { role: 'toolResult', toolCallId: 'test',
      toolName: 'schedule_change', content: [], isError: false, timestamp: 1 });
    const view = (row = line) => lineView(state, row, NO_ACTIVITY).outcome;
    assert.equal(view(), null);
    state.maintenanceOperations.record({ id: `verified-completion:${line.id}:${tail.seq}:${line.updatedAt}`,
      op: 'line.verify-delivery', args: {}, because: '测试回执', result: { delivered: true } });
    assert.equal(view(), 'done');
    assert.equal(view({ ...line, status: 'paused', pauseReason: 'stopped' }), 'stopped');
    assert.equal(view({ ...line, status: 'failed' }), 'failed');
    assert.equal(view({ ...line, updatedAt: 'changed' }), null);
    state.lineMessages.append(line.id, 'user', { role: 'user', content: '下一轮', timestamp: 2 });
    assert.equal(view(), null);
  } finally {
    await handle.close();
  }
});
