import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { ReceiptInput } from '../../shared/state.ts';
import { brainChange, openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function receiptInput(overrides: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    actionId: 'task-1:step-a:1:send_mail:9f2c',
    tool: 'send_mail',
    argsDigest: '9f2c',
    replay: 'once',
    effect: 'external',
    ...overrides,
  };
}

test('签发回执先落盘为 issued；同一动作标识再签发拿回同一张，不新建', () => {
  const first = t.state.receipts.issue(receiptInput());
  assert.equal(first.created, true);
  assert.equal(first.receipt.status, 'issued');
  const replay = t.state.receipts.issue(receiptInput({ argsDigest: 'different' }));
  assert.equal(replay.created, false);
  assert.equal(replay.receipt.argsDigest, '9f2c');
  assert.equal(t.state.receipts.withStatus('issued').length, 1);
});

test('送达、执行、核实三个时间戳分开存', () => {
  const { receipt } = t.state.receipts.issue(receiptInput());
  const delivered = t.state.receipts.update(receipt.actionId, 1, { deliveredAt: '2026-10-27T08:01:00.000Z' });
  const executed = t.state.receipts.update(receipt.actionId, 2, {
    status: 'succeeded',
    executedAt: '2026-10-27T08:02:00.000Z',
    resultRef: 'artifact:7',
  });
  assert.equal(delivered.executedAt, null);
  assert.equal(executed.deliveredAt, '2026-10-27T08:01:00.000Z');
  assert.equal(executed.executedAt, '2026-10-27T08:02:00.000Z');
  assert.equal(executed.verifiedAt, null);
  assert.equal(t.state.receipts.get(receipt.actionId)?.version, 3);
});

test('回执更新版本不对时报冲突，状态不被覆盖', () => {
  const { receipt } = t.state.receipts.issue(receiptInput());
  t.state.receipts.update(receipt.actionId, 1, { status: 'unknown' });
  const stale = (): unknown => t.state.receipts.update(receipt.actionId, 1, { status: 'succeeded' });
  const error = throwsState(stale, 'version_conflict');
  assert.equal(error.currentVersion, 2);
  assert.equal(t.state.receipts.get(receipt.actionId)?.status, 'unknown');
  throwsState(() => t.state.receipts.update('missing', 1, { status: 'failed' }), 'not_found');
});

