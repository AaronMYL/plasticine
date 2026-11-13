// 预测闭环第二步：建议卡他点了「开始做 / 加成待办」算收下、「忽略」算不要；一类攒够了、基本都忽略，先不再出，
// 隔一周放一条出去试试；常要的、常忽略的写进提示。
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ensureDefaultProjects } from '../../src/brain/index.ts';
import { linePrompt } from '../../src/lines/prompt.ts';
import { COLD_RETRY_MS, MIN_DECIDED } from '../../src/loop/tally.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { SuggestionDesk } from '../../src/tasks/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let current: TestState | undefined;
afterEach(async () => {
  await current?.cleanup();
  current = undefined;
});

const AT = '2026-11-13T08:00:00.000Z';

test('a kind he keeps ignoring is held back, then tried again a week later', async () => {
  current = await openTestState();
  const { state } = current;
  let now = new Date(AT);
  const desk = new SuggestionDesk({ state, lines: () => ({ open: () => 'line-x' }), now: () => now });
  const heartbeat = (index: number) => ({ title: `心跳想到的第 ${index} 件`, why: '刚看到', goal: '去做',
    projectId: null, source: 'heartbeat' as const, key: `hb-${index}` });
  for (let index = 0; index < MIN_DECIDED; index += 1) {
    const { suggestion } = desk.suggest(heartbeat(index));
    assert.ok(suggestion !== null);
    desk.dismiss(suggestion.id, 'device-mac', AT);
  }
  // 库里的时间是测试钟（一读走一秒）：「现在」对齐到最后一次有结果的那一刻。
  const last = Date.parse(state.loop.tallies('suggestion')[0]?.lastDecidedAt ?? AT);
  now = new Date(last + 60_000);
  const held = desk.suggest(heartbeat(99));
  assert.equal(held.suggestion, null);
  assert.equal(held.held, '心跳·其他');
  const other = desk.suggest({ ...heartbeat(100), source: 'plasticine', topic: '整理笔记' });
  assert.ok(other.suggestion !== null, '别的一类照常出');
  now = new Date(last + COLD_RETRY_MS + 60_000);
  assert.ok(desk.suggest(heartbeat(101)).suggestion !== null, '隔够了放一条出去试试');
});

test('kinds he takes and kinds he ignores show up in the line prompt once there are enough', async () => {
  current = await openTestState();
  const { state } = current;
  ensureDefaultProjects(state);
  const desk = new SuggestionDesk({ state, lines: () => ({ open: () => 'line-x' }) });
  const line = state.lines.main();
  assert.doesNotMatch(linePrompt(state, line), /他对建议卡的反应/);
  for (let index = 0; index < MIN_DECIDED; index += 1) {
    const kept = desk.suggest({ title: `读书 ${index}`, why: 'w', goal: 'g', projectId: null, source: 'plasticine',
      topic: '读书', key: `book-${index}` }).suggestion;
    assert.ok(kept !== null);
    desk.toTodo(kept.id, 'device-mac', AT);
  }
  const prompt = linePrompt(state, line);
  assert.match(prompt, /他常要的：读书（要了 5\/5）/);
  assert.equal(line.id, MAIN_LINE_ID);
});
