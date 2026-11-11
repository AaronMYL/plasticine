// 任务栏目的接口（《优化清单》第 3、4、5 条），在真的服务里跑（假模型，不联网）：对话里说一句 → 起草定时卡 → 他在卡上
// 确认 → 「定时」里多一行、多一位队友；开关、删；建议开始做 / 加成待办 / 忽略；设备报时区；项目页用同一份数据。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep }
  from '@earendil-works/pi-ai';
import { ASKS_PATH, DEVICE_TIME_ZONE_PATH, lineMessagesPath, SUGGESTIONS_PATH, TASKS_BOARD_PATH, TEAMMATE_STOP_PATH,
  TIMED_ENABLE_PATH, TIMED_REMOVE_PATH, type AskListResponse, type TasksBoardResponse }
  from '../../shared/api/index.ts';
import type { ModelSource } from '../../src/lines/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

const apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

let counter = 0;
function requestId(): string {
  counter += 1;
  return `tasks-request-${String(counter).padStart(4, '0')}`;
}

async function taskApp(steps: FauxResponseStep[]) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const source: ModelSource = {
    current: () => ({ model: faux.getModel(), thinking: 'off' }),
    streamFn: models.streamSimple.bind(models),
    complete: (model, context) => models.completeSimple(model, context),
  };
  faux.appendResponses(steps);
  const t = await startTestApp([], { lines: { models: source } });
  apps.push(t);
  return { t, cookie: await pair(t) };
}

async function board(t: TestApp, cookie: string, projectId?: string): Promise<TasksBoardResponse> {
  const query = projectId === undefined ? '' : `?projectId=${projectId}`;
  const reply = await call(t, 'GET', `${TASKS_BOARD_PATH}${query}`, { cookie });
  assert.equal(reply.status, 200);
  return json(reply) as unknown as TasksBoardResponse;
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`等不到：${what}`);
}

test('说一句「每周一早上帮我……」：起草定时卡 → 他确认 → 定时里一行、一位队友；能停、能删', async () => {
  const { t, cookie } = await taskApp([
    fauxAssistantMessage([fauxToolCall('schedule_propose', { title: '检查报名网站',
      goal: '打开报名网站看有没有新的半马名额，有就告诉他。', cadence: { type: 'weekly', days: [1], at: '09:00' },
      report: 'always' }, { id: 'p1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('好，每周一 9 点看一眼。'),
  ]);
  const sent = await call(t, 'POST', lineMessagesPath('main'), { cookie,
    body: { requestId: requestId(), text: '每周一早上帮我看一眼报名网站' } });
  assert.equal(sent.status, 200);
  await waitFor(() => t.app.deps.state.asks.open().length === 1, '定时卡');
  const asks = json(await call(t, 'GET', ASKS_PATH, { cookie })) as unknown as AskListResponse;
  const card = asks.current!;
  assert.equal(card.scheduleCard?.when, '周一 09:00');
  assert.equal(card.scheduleCard?.projectName, '个人');
  assert.equal(card.scheduleCard?.report, '每次做完告诉你');
  assert.equal(card.scheduleCard?.who, null);
  // 订阅、心跳、做梦也登记在「定时」里（第 6 批二段）；这里只看定时卡这一行。
  const cards = (view: TasksBoardResponse) => view.timed.filter((item) => item.source === 'schedule');
  const pending = await board(t, cookie);
  assert.equal(cards(pending)[0]?.last?.text, '等你确认');
  assert.equal(cards(pending)[0]?.canToggle, false);
  assert.deepEqual(pending.teammates.filter((mate) => mate.id.startsWith('schedule:')), [], '确认了才有队友');
  const answered = await call(t, 'POST', `${ASKS_PATH}/${card.id}/answer`, { cookie,
    body: { requestId: requestId(), optionId: 'confirm' } });
  assert.equal(answered.status, 200);
  await t.app.deps.lines.settled();
  const active = await board(t, cookie);
  assert.equal(cards(active).length, 1);
  const row = cards(active)[0]!;
  assert.equal(row.enabled, true);
  assert.equal(row.summary, '周一 09:00');
  assert.ok(row.nextAt !== null);
  const mate = active.teammates.find((item) => item.id === row.teammateId)!;
  assert.equal(mate.name, '检查报名网站');
  assert.equal(active.projects.find((project) => project.id === 'project-personal')?.counts.timed,
    active.timed.length);
  assert.equal((await board(t, cookie, 'project-plasticine')).timed.length, 0);
  const off = await call(t, 'POST', TIMED_ENABLE_PATH, { cookie,
    body: { requestId: requestId(), rowId: row.id, on: false } });
  assert.equal((json(off)['row'] as { enabled: boolean }).enabled, false);
  const on = await call(t, 'POST', TEAMMATE_STOP_PATH, { cookie,
    body: { requestId: requestId(), teammateId: mate.id } });
  assert.equal((json(on)['teammate'] as { glyph: string }).glyph, 'pause');
  const removed = await call(t, 'POST', TIMED_REMOVE_PATH, { cookie, body: { requestId: requestId(), rowId: row.id } });
  assert.equal(removed.status, 200);
  assert.equal(cards(await board(t, cookie)).length, 0);
  const gone = await call(t, 'POST', TIMED_ENABLE_PATH, { cookie,
    body: { requestId: requestId(), rowId: row.id, on: true } });
  assert.equal(gone.status, 404);
});

test('建议：Plasticine 提 → 开始做开一条线；加成待办进「个人」；忽略；处理过的再点是冲突', async () => {
  const { t, cookie } = await taskApp([
    fauxAssistantMessage([fauxToolCall('suggest', { title: '把悬赏规则整理成公开页', why: '这周你三次提到', goal: '整理',
      icon: 'file', key: 'rules' }, { id: 's1' }), fauxToolCall('suggest', { title: '给读书笔记做一页',
      why: '读到 63%', goal: '整理标注' }, { id: 's2' }), fauxToolCall('suggest', { title: '回复评审会邀请',
      why: '周老师昨天发来', goal: '起草回复' }, { id: 's3' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('放进建议了。'),
    fauxAssistantMessage('在做了。'),
  ]);
  await call(t, 'POST', lineMessagesPath('main'), { cookie, body: { requestId: requestId(), text: '有什么建议' } });
  await t.app.deps.lines.settled();
  const ideas = (await board(t, cookie)).ideas;
  assert.equal(ideas.length, 3);
  const [first, second, third] = [...ideas].reverse();
  const started = await call(t, 'POST', `${SUGGESTIONS_PATH}/${first!.id}/start`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(started.status, 200);
  const lineId = json(started)['lineId'] as string;
  assert.ok(t.app.deps.state.lines.get(lineId));
  const todo = await call(t, 'POST', `${SUGGESTIONS_PATH}/${second!.id}/todo`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(json(todo)['projectId'], 'project-personal');
  assert.ok(t.app.deps.state.projects.items.forProject('project-personal')
    .some((item) => item.title === '给读书笔记做一页'));
  const dismissed = await call(t, 'POST', `${SUGGESTIONS_PATH}/${third!.id}/dismiss`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(dismissed.status, 200);
  assert.equal((await board(t, cookie)).ideas.length, 0);
  const again = await call(t, 'POST', `${SUGGESTIONS_PATH}/${third!.id}/start`, { cookie,
    body: { requestId: requestId() } });
  assert.equal(again.status, 409);
  const suggestion = t.app.deps.state.suggestions.get(first!.id)!;
  assert.equal(suggestion.actedByDeviceId !== null, true);
  await t.app.deps.lines.settled();
});

test('设备报时区：记下，定时按它算；设置里选了的以设置为准；不认识的时区拒', async () => {
  const { t, cookie } = await taskApp([]);
  const reported = await call(t, 'POST', DEVICE_TIME_ZONE_PATH, { cookie, body: { timeZone: 'Asia/Tokyo' } });
  assert.equal(reported.status, 200);
  assert.equal(json(reported)['timeZone'], 'Asia/Tokyo');
  const bad = await call(t, 'POST', DEVICE_TIME_ZONE_PATH, { cookie, body: { timeZone: 'Mars/Base' } });
  assert.equal(bad.status, 400);
  const settings = t.app.deps.state.dailySettings.read();
  t.app.deps.state.dailySettings.save(settings.version, { timeZone: 'Europe/Paris' });
  assert.equal(t.app.deps.tasks.schedules.timeZone(), 'Europe/Paris');
});

test('任务四个动作：暂停的在「进行中」，停止的进「已结束」，删除的进「最近删除」、能恢复', async () => {
  const { t, cookie } = await taskApp([]);
  const kernel = t.app.deps.lines!;
  const open = (title: string) => kernel.open({ title, goal: title, parentLineId: null, projectId: null }, () => undefined);
  const paused = open('整理账单');
  const stopped = open('重装环境');
  const deleted = open('翻译博客');
  kernel.halt(paused.id);
  kernel.end(stopped.id);
  kernel.archive(deleted.id);
  const board = json(await call(t, 'GET', TASKS_BOARD_PATH, { cookie })) as TasksBoardResponse;
  assert.ok(board.running.some((line) => line.id === paused.id));
  assert.ok(!board.running.some((line) => line.id === stopped.id));
  assert.ok(board.ended.some((line) => line.id === stopped.id && line.outcome === 'stopped'));
  assert.deepEqual(board.deleted.map((line) => line.id), [deleted.id]);
  assert.equal(board.counts.deleted, 1);
  const restored = await call(t, 'POST', `/v2/lines/${deleted.id}/restore`, { cookie, body: { requestId: requestId() } });
  assert.equal(restored.status, 200);
  const after = json(await call(t, 'GET', TASKS_BOARD_PATH, { cookie })) as TasksBoardResponse;
  assert.equal(after.deleted.length, 0);
  assert.ok(after.running.some((line) => line.id === deleted.id));
});
