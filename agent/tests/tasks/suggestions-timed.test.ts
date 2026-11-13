// 建议（第 4 条）：同一个 key 不重复提；他点了开始做才开线、加成待办进项目（没归项目的进「个人」）、忽略就收起；
// 点的那一下记设备和时间。「定时」登记（第 3 条）和队友（第 5 条）：别的模块登记进来，开关、删、叫停派回各自。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { TimedRowView } from '../../shared/api/index.ts';
import { ensureDefaultProjects } from '../../src/brain/index.ts';
import { SuggestionDesk, teammatesFromRows, TimedRegistry, type TimedProvider } from '../../src/tasks/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
  ensureDefaultProjects(t.state);
});

afterEach(async () => {
  await t.cleanup();
});

function desk(opened: { title: string; goal: string }[] = []): SuggestionDesk {
  return new SuggestionDesk({ state: t.state, lines: () => ({ open: (input) => {
    opened.push(input);
    return `line-${opened.length}`;
  } }) });
}

const idea = { title: '把悬赏规则整理成公开页', why: '这周你三次说「悬赏规则还没写清」', goal: '整理成一页',
  source: 'plasticine' as const };

test('同一个 key 只提一次，忽略过的也不再提', () => {
  const suggestions = desk();
  const first = suggestions.suggest({ ...idea, key: 'rules-page' });
  assert.equal(first.created, true);
  assert.equal(first.suggestion.icon, 'sparkle');
  assert.equal(suggestions.suggest({ ...idea, key: 'rules-page' }).created, false);
  suggestions.dismiss(first.suggestion.id, 'device-mac', '2026-11-07T08:00:00.000Z');
  assert.equal(suggestions.suggest({ ...idea, key: 'rules-page' }).created, false);
  assert.deepEqual(suggestions.open(), []);
});

test('开始做：开一条后台线，记他点的那一下；处理过的不能再点', () => {
  const opened: { title: string; goal: string }[] = [];
  const suggestions = desk(opened);
  const { suggestion } = suggestions.suggest(idea);
  assert.ok(suggestion !== null);
  const started = suggestions.start(suggestion.id, 'device-mac', '2026-11-07T08:00:00.000Z');
  assert.equal(started.lineId, 'line-1');
  assert.equal(started.suggestion.status, 'started');
  assert.equal(started.suggestion.actedByDeviceId, 'device-mac');
  assert.match(opened[0]?.goal ?? '', /他在建议卡上点了「开始做」：把悬赏规则整理成公开页/);
  assert.throws(() => suggestions.dismiss(suggestion.id, 'device-mac', '2026-11-07T08:00:00.000Z'), /处理过了/);
});

test('加成待办：没归项目的进「个人」，待办记成他加的', () => {
  const suggestions = desk();
  const { suggestion } = suggestions.suggest(idea);
  assert.ok(suggestion !== null);
  const done = suggestions.toTodo(suggestion.id, 'device-mac', '2026-11-07T08:00:00.000Z');
  assert.equal(done.projectId, 'project-personal');
  const todo = t.state.projects.items.get(done.suggestion.todoId!);
  assert.equal(todo?.title, '把悬赏规则整理成公开页');
  assert.equal(todo?.addedBy, 'user');
});

function row(id: string, teammateId: string, enabled: boolean, glyph: TimedRowView['last']): TimedRowView {
  return { id, source: 'heartbeat', title: id, summary: '每 30 分钟', icon: 'pulse', hue: 'slate', nextAt: null,
    last: glyph, enabled, canToggle: true, canRemove: false, projectId: 'project-personal', lineId: null, askId: null,
    teammateId, sheet: true };
}

test('登记进来的来源：行汇总、开关派回、不能删的只能关、叫停停掉它管的每一行', () => {
  const state = new Map([['heartbeat', true]]);
  const provider: TimedProvider = {
    source: 'heartbeat',
    rows: () => [row('heartbeat', 'heartbeat', state.get('heartbeat') ?? false, { glyph: 'done', text: '没事' })],
    setEnabled: (rowId, on) => {
      state.set(rowId, on);
    },
  };
  const registry = new TimedRegistry();
  registry.register(provider);
  assert.throws(() => registry.register(provider), /登记过了/);
  assert.equal(registry.rows().length, 1);
  assert.throws(() => registry.remove('heartbeat'), /只能关掉/);
  assert.equal(registry.setEnabled('heartbeat', false)?.enabled, false);
  registry.setEnabled('heartbeat', true);
  const mate = registry.stop('heartbeat');
  assert.equal(mate?.glyph, 'pause');
  assert.equal(mate?.canStop, false);
  assert.throws(() => registry.setEnabled('nope', true), /没有这一项/);
});

test('队友按行推：同一位管几行（回顾管日报和周报），在跑的那一步优先', () => {
  const rows = [row('daily', 'review', true, { glyph: 'done', text: '早上 8:00 出了日报' }),
    row('weekly', 'review', true, { glyph: 'done', text: '已出' })];
  const mates = teammatesFromRows(rows, (item) => ({ name: '回顾', activity: item.id === 'weekly' ? '在写周报' : null,
    lineId: item.id === 'weekly' ? 'line-9' : null }));
  assert.equal(mates.length, 1);
  assert.equal(mates[0]?.name, '回顾');
  assert.equal(mates[0]?.glyph, 'run');
  assert.equal(mates[0]?.now, '在写周报');
  assert.deepEqual(mates[0]?.rowIds, ['daily', 'weekly']);
  assert.equal(mates[0]?.lineId, 'line-9');
});
