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

test('同一旧 id 第一次映射是新的，重跑再写同一映射是空操作', () => {
  assert.equal(t.state.legacyIds.record(mapping()), true);
  assert.equal(t.state.legacyIds.record(mapping()), false);
  assert.deepEqual(t.state.legacyIds.find('records.sqlite', 'agent_tasks', '41'), {
    targetTable: 'tasks',
    targetId: 'task-new-1',
  });
});

test('同一旧 id 不能再映射到别的新 id，原映射不变', () => {
  t.state.legacyIds.record(mapping());
  const error = throwsState(() => t.state.legacyIds.record(mapping({ targetId: 'task-new-2' })), 'duplicate');
  assert.match(error.message, /只能映射一次/);
  assert.equal(t.state.legacyIds.find('records.sqlite', 'agent_tasks', '41')?.targetId, 'task-new-1');
});

test('不同库、不同表里的同号旧 id 各自映射，互不冲突', () => {
  t.state.legacyIds.record(mapping());
  assert.equal(t.state.legacyIds.record(mapping({ sourceTable: 'runs', targetTable: 'runs', targetId: 'r1' })), true);
  assert.equal(t.state.legacyIds.record(mapping({ sourceDb: 'owner.sqlite', targetId: 'x' })), true);
  assert.equal(t.state.legacyIds.find('records.sqlite', 'agent_tasks', '42'), undefined);
});
