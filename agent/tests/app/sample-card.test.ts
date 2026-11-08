// 第 7 批第 14 条：研究周报样刊出来时附一张「开启定时 / 再改改」卡。样刊写完（space_write 出新一期、订阅还没开定时）
// 就出；服务起来时给「还没开定时、出过样刊、那一期没出过卡」的补一张，重启不重复；点「开启定时」订阅直接 active、主线
// 回一句确认；点「再改改」交回主线。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { AskListResponseSchema, type AskView } from '../../shared/api/index.ts';
import { researchDraft, SampleCards, scheduleText, subsTools, writeSpace } from '../../src/subs/index.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const DOC = { headline: '海马体的时间细胞', stats: [], blocks: [], sources: [] };

function draftWithSample(app: TestApp): string {
  const sub = app.state.subscriptions.create({ title: '认知科学与意识研究周报', kind: 'research', status: 'draft',
    timeZone: 'Asia/Shanghai', settings: researchDraft({ topics: ['意识'],
      schedule: { every: 'week', weekday: 5, time: '08:00' } }) });
  writeSpace(app.state, { title: '第 1 期', doc: DOC, subscriptionId: sub.id }, 'ai');
  return sub.id;
}

function openCards(body: unknown): AskView[] {
  assert.ok(Value.Check(AskListResponseSchema, body));
  return [body.current, ...body.queue].filter((ask): ask is AskView => ask !== null)
    .filter((ask) => ask.subscriptionCard !== undefined);
}

test('「每周五 08:00 出一期」按订阅设置拼', () => {
  const base = { id: 's', title: '周报', kind: 'research' as const, status: 'draft' as const, timeZone: 'UTC',
    lineId: null, lastRunAt: null, createdAt: '', updatedAt: '', version: 1 };
  assert.equal(scheduleText({ ...base, settings: researchDraft({ schedule: { every: 'week', weekday: 5,
    time: '08:00' } }) }), '每周五 08:00 出一期');
  assert.equal(scheduleText({ ...base, settings: researchDraft({ schedule: { every: 'day', time: '07:30' } }) }),
    '每天 07:30 出一期');
});

test('服务起来时补卡：出过样刊还没开定时的补一张，重启不重复；点「开启定时」订阅开了、主线回一句', async () => {
  t = await startTestApp([], { startTasks: false });
  const id = draftWithSample(t);
  const active = t.state.subscriptions.create({ title: '已经开了的', kind: 'research', status: 'active',
    timeZone: 'UTC', settings: researchDraft({}) });
  writeSpace(t.state, { title: '第 1 期', doc: DOC, subscriptionId: active.id }, 'ai');
  const directory = t.directory;
  await t.close(true);
  t = await startTestApp([], { startTasks: false, directory });
  await t.close(true);
  t = await startTestApp([], { startTasks: false, directory });
  const cookie = await pair(t);
  const cards = openCards((await call(t, 'GET', '/v2/asks', { cookie })).body);
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.ok(card !== undefined);
  assert.equal(card.question, '每周五 08:00 出一期');
  assert.equal(card.subscriptionCard?.title, '认知科学与意识研究周报');
  assert.equal(card.subscriptionCard?.subscriptionId, id);
  assert.equal(card.subscriptionCard?.issueNumber, 1);
  assert.deepEqual(card.options.map((option) => option.label), ['开启定时', '再改改']);
  assert.equal(card.lineId, null);

  const answered = await call(t, 'POST', `/v2/asks/${card.id}/answer`, { cookie,
    body: { requestId: 'sample-card-start', optionId: 'start' } });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  assert.equal(t.state.subscriptions.require(id).status, 'active');
  const notice: unknown = t.state.lineMessages.last('line-main', 'notice')?.message;
  const text = typeof notice === 'object' && notice !== null ? String(Reflect.get(notice, 'text')) : '';
  assert.match(text, /定时开好了：《认知科学与意识研究周报》每周五 08:00 出一期/);
});

test('样刊写完就出卡（space_write 出新一期）；改这一期不再出；「再改改」交回主线', async () => {
  t = await startTestApp([], { startTasks: false });
  const cookie = await pair(t);
  const sub = t.state.subscriptions.create({ title: '睡眠周报', kind: 'research', status: 'draft',
    timeZone: 'UTC', settings: researchDraft({}) });
  const told: string[] = [];
  const cards = new SampleCards({ state: t.state, desk: t.app.deps.desk, notice: () => undefined,
    tell: (text) => told.push(text) });
  const port = { open: () => 'line-sub', tell: () => true };
  const tool = subsTools(t.state, () => port, () => new Date(), (subscriptionId) => cards.offer(subscriptionId))
    .find((item) => item.name === 'space_write');
  assert.ok(tool !== undefined);
  const run = tool.create({ lineId: 'line-main', kind: 'main', projectId: null });
  const result = await run.execute('call-sample-1', { title: '第 1 期', doc: DOC, subscriptionId: sub.id } as never);
  const first = result.content[0];
  const written = JSON.parse(first?.type === 'text' ? first.text : '{}') as { id: string; version: number };
  await run.execute('call-sample-2', { id: written.id, version: written.version, title: '第 1 期（改）',
    doc: DOC } as never);
  const open = openCards((await call(t, 'GET', '/v2/asks', { cookie })).body);
  assert.equal(open.length, 1);
  assert.equal(open[0]?.subscriptionCard?.spaceId, written.id);
  // 「再改改」：订阅不动，交回主线问他改哪里。
  t.app.deps.desk.setResolver(cards.resolver);
  t.app.deps.desk.answer({ askId: open[0]?.id ?? '', optionId: 'revise', answerer: { deviceId: 'test-device' } });
  assert.equal(t.state.subscriptions.require(sub.id).status, 'sample');
  assert.match(told[0] ?? '', /点了「再改改」/);
});
