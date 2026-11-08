// 第 2 批（2026-11-04 用户定）：Plasticine 自己的后台活动进常驻项目 Plasticine 的后台；Plasticine 的通知信不进消息，
// 进后台。2026-11-05 任务删掉后，后台只剩定时、规则开关和通知信（停下的、在做的永远是空的）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Value } from 'typebox/value';
import {
  BackstageResponseSchema,
  SetBackstageRuleResponseSchema,
  type BackstageResponse,
} from '../../shared/api/index.ts';
import { isPlasticineNotice } from '../../shared/plasticine-notice.ts';
import { nextDailyAt } from '../../src/app/system-schedules.ts';
import { ensureIntake } from '../../src/intake/index.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

test('定时的下一次：今天的钟点还没到就是今天，过了就是明天（按那个时区）', () => {
  const morning = new Date('2026-11-04T22:30:00.000Z');
  assert.equal(nextDailyAt(morning, 'Asia/Shanghai', 7), '2026-11-04T23:00:00.000Z');
  const later = new Date('2026-11-04T23:30:00.000Z');
  assert.equal(nextDailyAt(later, 'Asia/Shanghai', 7), '2026-11-05T23:00:00.000Z');
  assert.equal(nextDailyAt(later, 'Asia/Shanghai', 0), '2026-11-05T16:00:00.000Z');
});

test('通知信的判断：只认 source = plasticine', () => {
  assert.equal(isPlasticineNotice({ source: 'plasticine' }), true);
  assert.equal(isPlasticineNotice({ source: 'email' }), false);
  assert.equal(isPlasticineNotice({ source: 'patrol' }), false);
});

async function backstage(app: TestApp, cookie: string): Promise<BackstageResponse> {
  const reply = await call(app, 'GET', '/v2/backstage?tz=Asia/Shanghai', { cookie });
  assert.equal(reply.status, 200);
  const body = json(reply) as unknown as BackstageResponse;
  assert.ok(Value.Check(BackstageResponseSchema, body), JSON.stringify([...Value.Errors(BackstageResponseSchema,
    body)].slice(0, 3)));
  return body;
}

test('后台：停下的、在做的是空的；定时写下次时间；规则带档位；通知信只认 Plasticine 的', async () => {
  t = await startTestApp([], { startTasks: false, automaticBackups: true });
  ensureIntake(t.state);
  t.state.feedSources.create({ kind: 'interest', label: '本地优先同步', query: 'local-first' });
  const cookie = await pair(t);
  t.state.inboxMessages.add({ source: 'plasticine', fromAddress: 'plasticine', title: '发布 #353 完成', body: '好了',
    receivedAt: '2026-10-27T07:00:00.000Z' });
  t.state.inboxMessages.add({ source: 'email', fromAddress: 'lin@example.com', title: '样例收到了', body: '',
    receivedAt: '2026-10-27T07:30:00.000Z' });

  const body = await backstage(t, cookie);
  assert.equal('stopped' in body || 'doing' in body, false);
  const backup = body.schedules.find((row) => row.id === 'backup');
  assert.equal(backup?.every, 'daily');
  assert.ok(backup !== undefined && Date.parse(backup.nextAt) > t.clock.now().getTime());
  const feedRule = body.rules.find((row) => row.code === 'feed_interest');
  assert.equal(feedRule?.on, false);
  assert.equal(body.rules.some((row) => row.code === 'self_fix' || row.code === 'trial_feedback'), false);
  assert.deepEqual(body.notices.map((row) => row.title), ['发布 #353 完成']);
});

test('后台的规则开关：记成你在设备上改的；按 requestId 幂等，版本旧了 409', async () => {
  t = await startTestApp([], { startTasks: false });
  ensureIntake(t.state);
  const cookie = await pair(t);
  const rule = t.state.rules.byCode('feed_interest');
  assert.ok(rule !== undefined);
  const request = { requestId: 'rule-on-1', version: rule.version, on: true };
  const reply = await call(t, 'POST', '/v2/backstage/rules/feed_interest', { cookie, body: request });
  assert.equal(reply.status, 200);
  const response = json(reply);
  assert.ok(Value.Check(SetBackstageRuleResponseSchema, response));
  assert.equal((response['rule'] as { on: boolean }).on, true);
  const changed = t.state.rules.byCode('feed_interest');
  assert.equal(changed?.mode, 'auto');
  const event = t.state.rules.events(rule.id).at(-1);
  assert.equal(event?.kind, 'mode_changed');
  assert.equal(event?.actor, 'user');
  assert.equal(event?.toMode, 'auto');

  const events = t.state.rules.events(rule.id).length;
  const again = await call(t, 'POST', '/v2/backstage/rules/feed_interest', { cookie, body: request });
  assert.equal(again.status, 200);
  assert.equal(t.state.rules.events(rule.id).length, events);
  const stale = await call(t, 'POST', '/v2/backstage/rules/feed_interest',
    { cookie, body: { requestId: 'rule-off-1', version: rule.version, on: false } });
  assert.equal(stale.status, 409);
  const missing = await call(t, 'POST', '/v2/backstage/rules/nope',
    { cookie, body: { requestId: 'rule-x-0001', version: 1, on: false } });
  assert.equal(missing.status, 404);
  const anonymous = await call(t, 'POST', '/v2/backstage/rules/feed_interest',
    { body: { requestId: 'rule-y-0001', version: 1, on: false } });
  assert.equal(anonymous.status, 401);
});
