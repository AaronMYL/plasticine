import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { LegacyId } from '../../shared/state.ts';
import { openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function mapping(overrides: Partial<LegacyId> = {}): LegacyId {
  return {
    sourceDb: 'records.sqlite',
    sourceTable: 'agent_tasks',
    legacyId: '41',
    targetTable: 'tasks',
    targetId: 'task-new-1',
    ...overrides,
  };
}

test('First legacy ID mapping creates entry; rerunning same mapping is a no-op', () => {
  assert.equal(t.state.legacyIds.record(mapping()), true);
  assert.equal(t.state.legacyIds.record(mapping()), false);
  assert.deepEqual(t.state.legacyIds.find('records.sqlite', 'agent_tasks', '41'), {
    targetTable: 'tasks',
    targetId: 'task-new-1',
  });
});

test('Rejects remapping an existing legacy ID to a different new ID', () => {
  t.state.legacyIds.record(mapping());
  const error = throwsState(() => t.state.legacyIds.record(mapping({ targetId: 'task-new-2' })), 'duplicate');
  assert.match(error.message, /只能映射一次/);
  assert.equal(t.state.legacyIds.find('records.sqlite', 'agent_tasks', '41')?.targetId, 'task-new-1');
});

test('Same legacy ID in different DBs or tables maps independently without conflict', () => {
  t.state.legacyIds.record(mapping());
  assert.equal(t.state.legacyIds.record(mapping({ sourceTable: 'runs', targetTable: 'runs', targetId: 'r1' })), true);
  assert.equal(t.state.legacyIds.record(mapping({ sourceDb: 'owner.sqlite', targetId: 'x' })), true);
  assert.equal(t.state.legacyIds.find('records.sqlite', 'agent_tasks', '42'), undefined);
});
