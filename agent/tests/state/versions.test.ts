import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { brainChange, device, openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('每次改动一条版本记录，按版本号从旧到新，快照是改完后的样子', () => {
  const agreement = t.state.agreements.create({ kind: 'collaboration', text: '一', scope: '合作' }, brainChange('脑开的'));
  t.state.agreements.update(agreement.id, 1, { text: '二' }, brainChange('改一次'));
  t.state.agreements.update(agreement.id, 2, { text: '三' }, brainChange('再改'));
  const entries = t.state.versions.list('agreement', agreement.id);
  assert.deepEqual(
    entries.map((entry) => [entry.version, entry.reason, entry.snapshot['text']]),
    [
      [1, '脑开的', '一'],
      [2, '改一次', '二'],
      [3, '再改', '三'],
    ],
  );
  assert.deepEqual(t.state.versions.list('agreement', 'nobody'), []);
});

test('设备确认的改动在版本记录里带设备和确认时间，普通改动不带', () => {
  const agreement = t.state.agreements.create({ kind: 'collaboration', text: '先问再做', scope: '合作' }, brainChange());
  t.state.agreements.confirm(agreement.id, 1, { state: 'active' }, device('ipad-1'), '用户采纳');
  const [created, confirmed] = t.state.versions.list('agreement', agreement.id);
  assert.equal(created?.confirmedByDeviceId, null);
  assert.equal(confirmed?.confirmedByDeviceId, 'ipad-1');
  assert.equal(confirmed?.confirmedByDeviceAt, device().confirmedAt);
  assert.equal(confirmed?.actorRef, 'ipad-1');
});
