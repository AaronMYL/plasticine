// 「定时」里的订阅、心跳、做梦（第 6 批二段），在真的服务里跑：任务栏目里有心跳、做梦、日报、周报四行；心跳的弹层接口
// 读设置和最近几次、改多久一次和清单；心跳只能关不能删；在对话里跟 Plasticine 说一句也能改清单。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseStep }
  from '@earendil-works/pi-ai';
import { HEARTBEAT_PATH, lineMessagesPath, TASKS_BOARD_PATH, TIMED_ENABLE_PATH, TIMED_REMOVE_PATH,
  type HeartbeatView, type TasksBoardResponse } from '../../shared/api/index.ts';
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
  return `heartbeat-request-${String(counter).padStart(4, '0')}`;
}

async function app(steps: FauxResponseStep[] = []) {
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

test('任务栏目「定时」里有心跳、做梦、日报、周报；心跳点开有弹层，只能关不能删', async () => {
  const { t, cookie } = await app();
  t.app.deps.tasks.schedules.tick();
  const board = json(await call(t, 'GET', TASKS_BOARD_PATH, { cookie })) as unknown as TasksBoardResponse;
  const rows = new Map(board.timed.map((row) => [row.id, row]));
  assert.equal(rows.get('heartbeat')?.summary, '每 30 分钟看一眼 · 23:00–08:00 不跳');
  assert.equal(rows.get('heartbeat')?.sheet, true);
  assert.equal(rows.get('dream')?.title, '做梦');
  assert.equal(rows.get('review:daily')?.title, '日报');
  assert.equal(rows.get('review:weekly')?.summary, '周日 21:00 · 个人回顾');
  assert.deepEqual(board.teammates.map((mate) => mate.name).sort(), ['做梦', '回顾', '心跳'].sort());
  const removed = await call(t, 'POST', TIMED_REMOVE_PATH, { cookie,
    body: { requestId: requestId(), rowId: 'heartbeat' } });
  assert.equal(removed.status, 409);
  const off = await call(t, 'POST', TIMED_ENABLE_PATH, { cookie,
    body: { requestId: requestId(), rowId: 'heartbeat', on: false } });
  assert.equal((json(off)['row'] as { enabled: boolean }).enabled, false);
});

test('心跳弹层：读、改多久一次、拖过的清单整份存回', async () => {
  const { t, cookie } = await app();
  const read = json(await call(t, 'GET', HEARTBEAT_PATH, { cookie })) as unknown as HeartbeatView;
  assert.equal(read.config.intervalMinutes, 30);
  assert.equal(read.config.items.length, 7);
  const items = [...read.config.items].reverse().slice(0, 3).map((item) => ({ id: item.id, text: item.text }));
  const saved = await call(t, 'PUT', HEARTBEAT_PATH, { cookie, body: { requestId: requestId(), intervalMinutes: 60,
    items: [...items, { text: '快递到了没有' }] } });
  assert.equal(saved.status, 200);
  const view = json(saved) as unknown as HeartbeatView;
  assert.equal(view.config.intervalMinutes, 60);
  assert.deepEqual(view.config.items.map((item) => item.text), ['信息流里命中关注点的', '今天到期的项目待办',
    '朋友发来还没回的消息和任务卡', '快递到了没有']);
  assert.equal(view.config.items.at(-1)?.kind, 'custom');
});

test('在对话里跟 Plasticine 说一句：它用 heartbeat_checklist 改清单', async () => {
  const { t, cookie } = await app([
    fauxAssistantMessage([fauxToolCall('heartbeat_checklist', { action: 'set',
      items: ['要回复的邮件', '今天到期的项目待办'] }, { id: 'h1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('好，心跳以后只看邮件和到期的待办。'),
  ]);
  const sent = await call(t, 'POST', lineMessagesPath('main'), { cookie,
    body: { requestId: requestId(), text: '心跳只看邮件和到期的待办就行' } });
  assert.equal(sent.status, 200);
  await t.app.deps.lines.settled();
  const view = t.app.deps.heartbeat.view();
  assert.deepEqual(view.config.items.map((item) => item.id), ['mail', 'due']);
});
