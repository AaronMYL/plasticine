import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openTestState, type TestState } from './helpers.ts';

let current: TestState | undefined;
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

async function open(): Promise<TestState> {
  current = await openTestState();
  return current;
}

test('a prediction is recorded once per source and its outcome is written only once', async () => {
  const { state } = await open();
  const id = state.loop.record({ area: 'ask', topic: ' 排日程 ', ref: 'ask-1', expected: '周三上午' });
  assert.equal(state.loop.record({ area: 'ask', topic: '排日程', ref: 'ask-1', expected: '别的' }), id);
  assert.equal(state.loop.resolveByRef('ask', 'ask-1', 'kept'), true);
  assert.equal(state.loop.resolveByRef('ask', 'ask-1', 'rejected'), false);
  assert.deepEqual(state.loop.tallies('ask').map(({ topic, kept, decided }) => ({ topic, kept, decided })),
    [{ topic: '排日程', kept: 1, decided: 1 }]);
});

test('notes report by id and only within their own area', async () => {
  const { state } = await open();
  const id = state.loop.record({ area: 'note_predict', topic: '续写', expected: '然后去公园' });
  assert.ok(id !== null);
  assert.equal(state.loop.resolveById('note_supplement', id, 'kept'), false);
  assert.equal(state.loop.resolveById('note_predict', id, 'rejected'), true);
  assert.deepEqual(state.loop.samples('note_predict', ['rejected'], 5).map((sample) => sample.expected),
    ['然后去公园']);
  assert.equal(state.loop.record({ area: 'note_predict', topic: '  ', expected: 'x' }), null);
});

test('outcomes come newest first and can start after a revocation', async () => {
  const { state } = await open();
  for (const [index, outcome] of (['kept', 'changed', 'kept'] as const).entries()) {
    state.loop.record({ area: 'ask', topic: '回邮件', ref: `a${index}`, expected: '回' });
    state.loop.resolveByRef('ask', `a${index}`, outcome);
  }
  assert.deepEqual(state.loop.outcomes('ask', '回邮件', 10), ['kept', 'changed', 'kept']);
  const grant = state.loop.grants.grant('回邮件', 'device-1', 'ask-9');
  assert.equal(state.loop.grants.active('回邮件')?.id, grant.id);
  assert.equal(state.loop.grants.revoke('回邮件', '他说还是先问'), true);
  assert.equal(state.loop.grants.active('回邮件'), undefined);
  const since = state.loop.grants.lastRevokedAt('回邮件');
  assert.ok(since !== null);
  assert.deepEqual(state.loop.outcomes('ask', '回邮件', 10, since), []);
  assert.equal(state.loop.corrections('2000-01-01T00:00:00.000Z').length, 1);
});

test('a grant needs his device and the card he answered', async () => {
  const { state } = await open();
  assert.throws(() => state.loop.grants.grant('回邮件', '', 'ask-1'));
  state.loop.selfNotes.write('排日程这类他基本原样收下。');
  assert.equal(state.loop.selfNotes.latest()?.text, '排日程这类他基本原样收下。');
});
