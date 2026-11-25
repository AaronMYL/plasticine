import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { brainChange, openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const ENTRY = { kind: 'quote', basis: 'self_reported', sourceId: 'source-user-said', provenance: '对话' } as const;

test('Each edit records a version snapshot ordered oldest-to-newest', () => {
  const entry = t.state.memory.create({ ...ENTRY, text: '一' }, brainChange('脑开的'));
  t.state.memory.update(entry.id, 1, { text: '二' }, brainChange('改一次'));
  t.state.memory.update(entry.id, 2, { text: '三' }, brainChange('再改'));
  const entries = t.state.versions.list('memory_entry', entry.id);
  assert.deepEqual(
    entries.map((item) => [item.version, item.reason, item.snapshot['text']]),
    [
      [1, '脑开的', '一'],
      [2, '改一次', '二'],
      [3, '再改', '三'],
    ],
  );
  assert.deepEqual(t.state.versions.list('memory_entry', 'nobody'), []);
});
