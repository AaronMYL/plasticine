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

test('模块出口不给数据库句柄：没有 db、没有通用存储、没有迁移函数', () => {
  const exported = Object.keys(stateModule);
  for (const internal of ['openDatabase', 'Database', 'ObjectStore', 'migrate', 'MIGRATIONS']) {
    assert.equal(exported.includes(internal), false, `${internal} 不该从 state/index.ts 导出`);
  }
  assert.equal('db' in t.state, false);
});

test('关掉再打开，写过的对象都还在', () => {
  const agreement = t.state.agreements.create({ kind: 'collaboration', text: '先问再做', scope: '合作' }, brainChange());
  t.close();
  const reopened = stateModule.openState({ path: t.path });
  try {
    assert.equal(reopened.agreements.require(agreement.id).text, agreement.text);
    assert.deepEqual(reopened.newlyApplied, []);
  } finally {
    reopened.close();
  }
});
