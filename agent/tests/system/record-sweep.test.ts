import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { NodeActionInput } from '../../shared/state.ts';
import { RecordSweep, SWEEP_BATCH } from '../../src/system/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const NOW = new Date('2026-11-17T08:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function act(actionId: string, requestedAt: string, status: NodeActionInput['status'], result: unknown): void {
  const row = t.state.nodeActions.record({ actionId, nodeId: 'node-1', kind: 'tab_read', actionClass: 'browser',
    target: '示例网页', paramsDigest: 'b'.repeat(64), status: 'sent', origin: 'brain', requestedAt });
  t.state.nodeActions.update(row.id, row.version, { status, result });
}

function receipt(requestId: string, expiresAt: string): void {
  t.state.apiRequests.save({ requestId, scope: 'notes.save', deviceId: null, status: 200, body: { ok: true },
    createdAt: daysAgo(40), expiresAt });
}

test('Prunes receipt bodies older than 30d keeping action row; keeps recent/pending', () => {
  act('old-done', daysAgo(31), 'executed', { text: '很长的网页全文' });
  act('old-failed', daysAgo(45), 'failed', { errorCode: 'timed_out' });
  act('old-unknown', daysAgo(45), 'unknown', { note: '结果不明，等回执' });
  act('recent', daysAgo(29), 'executed', { text: '还要用的' });
  const sweep = new RecordSweep(t.state, () => NOW);
  assert.deepEqual(sweep.run(), { trimmed: 2, purged: 0 });
  assert.equal(t.state.nodeActions.byActionId('old-done')?.result, null);
  assert.equal(t.state.nodeActions.byActionId('old-done')?.status, 'executed');
  assert.equal(t.state.nodeActions.byActionId('old-failed')?.result, null);
  assert.deepEqual(t.state.nodeActions.byActionId('old-unknown')?.result, { note: '结果不明，等回执' });
  assert.deepEqual(t.state.nodeActions.byActionId('recent')?.result, { text: '还要用的' });
});

test('Deletes expired API receipts while keeping unexpired ones', () => {
  receipt('expired', daysAgo(1));
  receipt('alive', new Date(NOW.getTime() + 60_000).toISOString());
  assert.deepEqual(new RecordSweep(t.state, () => NOW).run(), { trimmed: 0, purged: 1 });
  assert.equal(t.state.apiRequests.find('expired'), undefined);
  assert.equal(t.state.apiRequests.find('alive')?.status, 200);
});

test('Prunes one batch per tick; continues next tick if full, waits till next day done', () => {
  for (let index = 0; index < SWEEP_BATCH + 3; index += 1) {
    receipt(`expired-${index}`, daysAgo(2));
  }
  let now = NOW;
  const sweep = new RecordSweep(t.state, () => now);
  assert.equal(sweep.run().purged, SWEEP_BATCH);
  assert.equal(sweep.run().purged, 3);
  receipt('later', daysAgo(1));
  assert.equal(sweep.run().purged, 0);
  now = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(sweep.run().purged, 1);
});
