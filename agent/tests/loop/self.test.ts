// 预测闭环第四步：心跳看自己的读数（偏离了才有）；做梦后写说明书，之后每次请求都带上。
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { linePrompt } from '../../src/lines/prompt.ts';
import { CORRECTIONS_HIGH, loopReadings } from '../../src/loop/readings.ts';
import { selfNotesMaterial, writeSelfNotes } from '../../src/loop/self-notes.ts';
import { scriptedText } from '../brain/helpers.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let current: TestState | undefined;
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

function correct(state: TestState['state'], count: number): void {
  for (let index = 0; index < count; index += 1) {
    state.loop.record({ area: 'ask', topic: '回邮件', ref: `ask-${index}`, expected: '按上次的口气回' });
    state.loop.resolveByRef('ask', `ask-${index}`, 'changed', '更客气一点');
  }
}

test('readings stay quiet until he has corrected it often enough in a day', async () => {
  current = await openTestState();
  const { state } = current;
  correct(state, CORRECTIONS_HIGH - 1);
  const later = new Date('2026-10-27T09:00:00.000Z');
  assert.deepEqual(loopReadings(state, later), []);
  correct(state, CORRECTIONS_HIGH);
  const facts = loopReadings(state, later);
  assert.equal(facts.length, 1);
  assert.match(facts[0]?.text ?? '', /改了或没要你 3 次（多在「回邮件」）/);
});

test('the night writes self-notes from his corrections and every line prompt carries them', async () => {
  current = await openTestState();
  const { state } = current;
  const now = new Date('2026-10-27T09:00:00.000Z');
  assert.equal(selfNotesMaterial(state, now), null, '没有结果就不写');
  correct(state, 2);
  const material = selfNotesMaterial(state, now) ?? '';
  assert.match(material, /我给的「按上次的口气回」→ 他改成「更客气一点」/);
  const model = scriptedText(['好的：\n- 回邮件他常改得更客气，下次先写客气一点。\n多余的一行']);
  assert.equal(await writeSelfNotes(state, model.models, now, new AbortController().signal), true);
  assert.equal(model.requests[0]?.purpose, 'dream');
  const prompt = linePrompt(state, state.lines.main());
  assert.match(prompt, /我自己的说明书/);
  assert.match(prompt, /- 回邮件他常改得更客气/);
  assert.doesNotMatch(prompt, /多余的一行/);
  assert.equal(await writeSelfNotes(state, model.models, now, new AbortController().signal), false,
    '写完以后没有新结果：不再写');
});
