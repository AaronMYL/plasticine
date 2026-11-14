// 预测消息（11-13）：没轮到他说、空草稿不猜；轮到了给整句；有草稿只给后面的、去掉和草稿重叠的；只给一句；攒够了带上
// 他收下过和没要的原样。
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ComposePredictor, type ComposeContext } from '../../src/brain/index.ts';
import { COMPOSE_SYSTEM } from '../../src/brain/compose-predictor.ts';
import { MIN_DECIDED } from '../../src/loop/tally.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { scriptedText } from './helpers.ts';

let current: TestState | undefined;
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

const signal = (): AbortSignal => new AbortController().signal;
const talk = (myTurn: boolean): ComposeContext => ({ with: 'Plasticine', myTurn, turns: [
  { who: 'me', name: '他', text: '它是什么时候装上的？' },
  { who: 'other', name: 'Plasticine', text: '10 月 28 日装的，是你自己下的。' },
] });

test('the prompt always asks for a guess: a wrong one costs nothing (11-14 live: told to give nothing when unsure, the '
  + 'model gave nothing every time)', () => {
  assert.doesNotMatch(COMPOSE_SYSTEM, /输出空/);
  assert.match(COMPOSE_SYSTEM, /一定给出一句/);
});

test('empty draft when it is not his turn: no guess and no model call', async () => {
  const model = scriptedText(['不该被调']);
  const predictor = new ComposePredictor(model.models);
  assert.deepEqual(await predictor.predict('', talk(false), signal()), { text: '' });
  assert.deepEqual(await predictor.predict('', { ...talk(true), turns: [] }, signal()), { text: '' });
  assert.equal(model.requests.length, 0);
});

test('his turn: a whole sentence from the conversation, through the compose model purpose', async () => {
  const model = scriptedText(['那现在还用得着吗？\n第二行不要']);
  const predictor = new ComposePredictor(model.models);
  const streamed: string[] = [];
  const view = await predictor.predict('', talk(true), signal(), (delta) => streamed.push(delta));
  assert.equal(view.text, '那现在还用得着吗？');
  assert.equal(model.requests[0]?.purpose, 'compose_predict');
  // 关不掉思考的模型也有字可出：和续写一样给 2048。
  assert.equal(model.requests[0]?.maxOutputTokens, 2048);
  const payload = JSON.parse(String(model.requests[0]?.messages[0]?.content)) as Record<string, unknown>;
  assert.equal(payload['在和谁说'], 'Plasticine');
  assert.deepEqual(payload['最近的消息'], [{ 谁: '他', 说: '它是什么时候装上的？' },
    { 谁: 'Plasticine', 说: '10 月 28 日装的，是你自己下的。' }]);
  assert.equal(payload['草稿'], '');
});

test('with a draft it only adds what comes after, without repeating the draft', async () => {
  const model = scriptedText(['用得着吗？不用就卸了']);
  const predictor = new ComposePredictor(model.models);
  const view = await predictor.predict('那现在还用得着', talk(false), signal());
  assert.equal(view.text, '吗？不用就卸了');
});

test('kept and dropped suggestions shape the next prompt once there are enough', async () => {
  current = await openTestState();
  const { state } = current;
  const replies = Array.from({ length: MIN_DECIDED + 1 }, (_, index) => `好的${index}`);
  const model = scriptedText(replies);
  const predictor = new ComposePredictor(model.models, state);
  for (let index = 0; index < MIN_DECIDED; index += 1) {
    const view = await predictor.predict('', talk(true), signal());
    assert.ok(view.loopId !== undefined);
    state.loop.resolveById('message_predict', view.loopId, index === 0 ? 'rejected' : 'kept');
  }
  assert.doesNotMatch(model.requests[0]?.system ?? '', /他收下过的/);
  await predictor.predict('', talk(true), signal());
  const last = model.requests.at(-1)?.system ?? '';
  assert.match(last, /他以前对输入建议的反应/);
  assert.match(last, /他没要的：\n- 「好的0」/);
});
