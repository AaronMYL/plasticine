import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MIN_DECIDED } from '../../src/loop/tally.ts';
import { predictHabits, supplementHabits, SUPPLEMENT_TOPICS } from '../../src/loop/writing.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let current: TestState | undefined;
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

function settle(state: TestState['state'], area: 'note_predict' | 'note_supplement', topic: string,
  expected: string, outcome: 'kept' | 'rejected'): void {
  const id = state.loop.record({ area, topic, expected });
  assert.ok(id !== null);
  state.loop.resolveById(area, id, outcome);
}

test('without enough records the continuation prompt is unchanged', async () => {
  current = await openTestState();
  const { state } = current;
  for (let index = 0; index < MIN_DECIDED - 1; index += 1) {
    settle(state, 'note_predict', '续写', `收下的第 ${index} 句`, 'kept');
  }
  assert.equal(predictHabits(state), '');
});

test('with enough records the continuation prompt carries what he kept and what he dropped', async () => {
  current = await openTestState();
  const { state } = current;
  for (let index = 0; index < 3; index += 1) {
    settle(state, 'note_predict', '续写', `短句${index}`, 'kept');
  }
  settle(state, 'note_predict', '续写', '综上所述，我们可以看到', 'rejected');
  settle(state, 'note_predict', '续写', '总而言之，这件事意义重大', 'rejected');
  const habits = predictHabits(state);
  assert.match(habits, /他收下过的/);
  assert.match(habits, /短句2/);
  assert.match(habits, /他没要的/);
  assert.match(habits, /综上所述/);
});

test('supplement kinds he never takes are named, kinds he takes are preferred', async () => {
  current = await openTestState();
  const { state } = current;
  for (let index = 0; index < MIN_DECIDED; index += 1) {
    settle(state, 'note_supplement', SUPPLEMENT_TOPICS.contact, `联系人${index}`, 'rejected');
    settle(state, 'note_supplement', SUPPLEMENT_TOPICS.example, `举例${index}`, 'kept');
  }
  const habits = supplementHabits(state);
  assert.match(habits, /少给.*联系人/);
  assert.match(habits, /多给.*举例/);
  assert.doesNotMatch(habits, /结构/);
});
