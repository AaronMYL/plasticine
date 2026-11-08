import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { MemoryEntryInput } from '../../shared/state.ts';
import { brainChange, openTestState, throwsState, userChange, userSource, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function entryInput(sourceId: string, overrides: Partial<MemoryEntryInput> = {}): MemoryEntryInput {
  return {
    text: '我更在意个人表达',
    kind: 'quote',
    basis: 'self_reported',
    sourceId,
    provenance: '10-26 对话',
    ...overrides,
  };
}

test('原话和解释分两条存，各自的身份和依据不混', () => {
  const sourceId = userSource(t.state);
  const quote = t.state.memory.create(
    entryInput(sourceId, { anchor: { kind: 'message', ref: 'm1' } }),
    brainChange(),
  );
  const reading = t.state.memory.create(
    entryInput(sourceId, { text: '他可能想少做商业项目', kind: 'interpretation', basis: 'inferred' }),
    brainChange(),
  );
  assert.equal(t.state.memory.require(quote.id).anchor?.ref, 'm1');
  assert.deepEqual(
    t.state.memory.list({ kind: 'interpretation' }).map((entry) => entry.id),
    [reading.id],
  );
});

test('用户改记忆留下编辑记录，记录里是用户和改了哪个字段', () => {
  const entry = t.state.memory.create(entryInput(userSource(t.state)), brainChange());
  t.state.memory.update(entry.id, 1, { text: '我更在意个人表达，也在意稳定' }, userChange());
  const edit = t.state.memory.history(entry.id).at(-1);
  assert.equal(edit?.actor, 'user');
  assert.deepEqual(edit?.fields, ['text']);
});

test('用户删记忆只打删除时间，列表里看不到，行和历史都还在', () => {
  const entry = t.state.memory.create(entryInput(userSource(t.state)), brainChange());
  t.state.memory.update(entry.id, 1, { deletedAt: '2026-10-27T10:00:00.000Z' }, userChange('用户删了'));
  assert.deepEqual(t.state.memory.list(), []);
  assert.equal(t.state.memory.listAll().length, 1);
  assert.equal(t.state.memory.history(entry.id).length, 2);
});

test('记忆视图按身份分栏、新建的在前；归档（删）的默认不出现，要看时带上', () => {
  const sourceId = userSource(t.state);
  const older = t.state.memory.create(entryInput(sourceId, { text: '早的原话' }), brainChange());
  const newer = t.state.memory.create(entryInput(sourceId, { text: '新的原话' }), brainChange());
  const reading = t.state.memory.create(
    entryInput(sourceId, { text: '一条解释', kind: 'interpretation', basis: 'inferred' }),
    brainChange(),
  );
  t.state.memory.update(older.id, 1, { deletedAt: '2026-10-27T10:00:00.000Z' }, userChange('归档'));
  const ids = (entries: { id: string }[]): string[] => entries.map((entry) => entry.id);
  assert.deepEqual(ids(t.state.memory.newestFirst('quote', false, {})), [newer.id]);
  assert.deepEqual(ids(t.state.memory.newestFirst('quote', true, {})), [newer.id, older.id]);
  assert.deepEqual(ids(t.state.memory.newestFirst('interpretation', false, {})), [reading.id]);
});

test('进上下文的记忆：没删、没标过时的全部条目，一页装不下也读全', () => {
  const sourceId = userSource(t.state);
  const live = t.state.memory.create(entryInput(sourceId), brainChange());
  const stale = t.state.memory.create(entryInput(sourceId, { text: '过时的', stale: true }), brainChange());
  const gone = t.state.memory.create(entryInput(sourceId, { text: '删掉的' }), brainChange());
  t.state.memory.update(gone.id, 1, { deletedAt: '2026-10-27T10:00:00.000Z' }, userChange('删'));
  assert.deepEqual(t.state.memory.inUse().map((entry) => entry.id), [live.id]);
  assert.notEqual(stale.id, live.id);
});

test('记忆条目必须写来源', () => {
  // 来源账 2026-11-05 删掉了：不再查来源存不存在，只要求写了。
  throwsState(() => t.state.memory.create(entryInput(''), brainChange()), 'invalid_input');
});
