import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { NoteAssistant } from '../../src/brain/index.ts';
import { MIN_DECIDED } from '../../src/loop/tally.ts';
import { scriptedText } from '../brain/helpers.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let current: TestState | undefined;
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

const signal = (): AbortSignal => new AbortController().signal;

test('the loop closes: what he does with continuations changes the next continuation prompt', async () => {
  current = await openTestState();
  const { state } = current;
  const replies = Array.from({ length: MIN_DECIDED + 1 }, (_, index) => `第${index}句`);
  const model = scriptedText(replies);
  const assistant = new NoteAssistant(model.models, state);
  const first = await assistant.suggest({ action: 'predict', markdown: '今天' }, signal());
  assert.ok(first.loopId !== undefined);
  assert.doesNotMatch(model.requests[0]?.system ?? '', /他收下过的/);
  state.loop.resolveById('note_predict', first.loopId, 'rejected');
  for (let index = 1; index < MIN_DECIDED; index += 1) {
    const view = await assistant.suggest({ action: 'predict', markdown: '今天' }, signal());
    assert.ok(view.loopId !== undefined);
    state.loop.resolveById('note_predict', view.loopId, 'kept');
  }
  await assistant.suggest({ action: 'predict', markdown: '今天' }, signal());
  const last = model.requests.at(-1)?.system ?? '';
  assert.match(last, /他收下过的/);
  assert.match(last, /第4句/);
  assert.match(last, /他没要的：\n- 「第0句」/);
});

test('each supplement carries its own loop id and an unreported one changes nothing', async () => {
  current = await openTestState();
  const { state } = current;
  const reply = JSON.stringify([{ kind: 'example', text: '举个例子', draft: '比如说……' },
    { kind: 'structure', text: '拆成两段', draft: '第一段\n\n第二段' }]);
  const model = scriptedText([reply]);
  const assistant = new NoteAssistant(model.models, state);
  const view = await assistant.suggest({ action: 'interject', markdown: '一段话写完了。' }, signal());
  const ids = (view.suggestions ?? []).map((item) => item.loopId);
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => typeof id === 'string'));
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(state.loop.tallies('note_supplement'), []);
});
