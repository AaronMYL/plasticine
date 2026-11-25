import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import * as stateModule from '../../src/state/index.ts';
import { brainChange, openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('State module exports omit raw DB handle, generic store, and migrate functions', () => {
  const exported = Object.keys(stateModule);
  for (const internal of ['openDatabase', 'Database', 'ObjectStore', 'migrate', 'MIGRATIONS']) {
    assert.equal(exported.includes(internal), false, `${internal} 不该从 state/index.ts 导出`);
  }
  assert.equal('db' in t.state, false);
});

test('Written objects persist across closing and reopening the database', () => {
  const entry = t.state.memory.create({ kind: 'quote', basis: 'self_reported', text: '先问再做',
    sourceId: 'source-user-said', provenance: '对话' }, brainChange());
  t.close();
  const reopened = stateModule.openState({ path: t.path });
  try {
    assert.equal(reopened.memory.require(entry.id).text, entry.text);
    assert.deepEqual(reopened.newlyApplied, []);
  } finally {
    reopened.close();
  }
});
