import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { LegacyRowInput } from '../../shared/state.ts';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function row(overrides: Partial<LegacyRowInput> = {}): LegacyRowInput {
  return {
    sourceDb: 'records.sqlite',
    sourceTable: 'ledger_cards',
    legacyId: 'card-1',
    targetTable: null,
    targetId: null,
    payload: { table: 'ledger_cards', row: { id: 'card-1', data: { kind: 'decode' } } },
    reason: '旧版的卡不迁成对象，原样存档',
    ...overrides,
  };
}

test('旧行整行存档；同样的再存一次是空操作', () => {
  assert.equal(t.state.legacyRows.record(row()), 'created');
  assert.equal(t.state.legacyRows.record(row()), 'unchanged');
  assert.equal(t.state.legacyRows.count('records.sqlite', 'ledger_cards'), 1);
  assert.deepEqual(t.state.legacyRows.find('records.sqlite', 'ledger_cards', 'card-1')?.payload, row().payload);
});

test('同一旧行换了内容再存：拒绝，存档不被覆盖', () => {
  t.state.legacyRows.record(row());
  throwsState(() => t.state.legacyRows.record(row({ payload: { changed: true } })), 'duplicate');
  assert.deepEqual(t.state.legacyRows.find('records.sqlite', 'ledger_cards', 'card-1')?.payload, row().payload);
});

test('先存档时还没有对应对象，之后补上挂靠；已挂靠的不能改挂别处', () => {
  t.state.legacyRows.record(row());
  assert.equal(t.state.legacyRows.record(row({ targetTable: 'judgments', targetId: 'j1' })), 'attached');
  assert.equal(t.state.legacyRows.find('records.sqlite', 'ledger_cards', 'card-1')?.targetId, 'j1');
  throwsState(() => t.state.legacyRows.record(row({ targetTable: 'judgments', targetId: 'j2' })), 'duplicate');
  throwsState(() => t.state.legacyRows.record(row({ targetTable: 'concerns', targetId: 'j1' })), 'duplicate');
  assert.equal(t.state.legacyRows.find('records.sqlite', 'ledger_cards', 'card-1')?.targetTable, 'judgments');
});

test('快照类存档（采访排期）换了内容：旧的原样另存一条，主存档换成新的；同样内容再来是空操作', () => {
  const first = row({ legacyId: 'plans', payload: { table: 'interview/plans.json', row: { '2026-10-27': 1 } } });
  assert.equal(t.state.legacyRows.supersede(first), 'created');
  const kept = t.state.legacyRows.find('records.sqlite', 'ledger_cards', 'plans');
  const next = row({ legacyId: 'plans', payload: { table: 'interview/plans.json', row: { '2026-10-29': 1 } } });
  assert.equal(t.state.legacyRows.supersede(next), 'created');
  assert.deepEqual(t.state.legacyRows.find('records.sqlite', 'ledger_cards', 'plans')?.payload, next.payload);
  const old = t.state.legacyRows.find('records.sqlite', 'ledger_cards', `plans@${kept?.createdAt ?? ''}`);
  assert.deepEqual(old?.payload, first.payload);
  assert.equal(t.state.legacyRows.supersede(next), 'unchanged');
  assert.equal(t.state.legacyRows.count('records.sqlite', 'ledger_cards'), 2);
});