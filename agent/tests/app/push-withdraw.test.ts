import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { pushTag, type PushPayload } from '../../shared/api/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { withdrawnText } from '../../src/app/pushes.ts';
import { fakeBrowser } from '../attention/helpers.ts';
import { call, pair, startTestApp, type TestApp } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function sent(app: TestApp, count: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (app.pushes.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('retract sends retracted notice with same tag to subscribed devices; second retract is no-op', async () => {
  t = await startTestApp([], { dryRun: true });
  const cookie = await pair(t);
  const browser = fakeBrowser();
  await call(t, 'POST', '/v2/push/subscriptions', { cookie,
    body: { requestId: 'req-push-0002', endpoint: 'https://push.example.com/send/phone', keys: browser.keys } });
  const { push } = t.state.pushes.add({ lineId: MAIN_LINE_ID, callKey: 'k1', title: '示例科技回你了：方便明天下午聊吗',
    url: '/#/plasticine' });
  const body = { requestId: 'req-withdraw-01', id: push.id };
  assert.equal((await call(t, 'POST', '/v2/pushes/withdraw', { cookie, body })).status, 200);
  await sent(t, 1);
  assert.equal(t.pushes.length, 1);
  const payload = JSON.parse(browser.decrypt(t.pushes[0]?.request.body ?? Buffer.alloc(0))) as PushPayload;
  assert.deepEqual(payload, { title: 'Plasticine', body: withdrawnText(push.title), url: '/#/plasticine',
    tag: pushTag(push.id) });
  assert.match(payload.body, /^「示例科技回你了：方便明天下午聊吗」这条推送已撤回$/);
  await call(t, 'POST', '/v2/pushes/withdraw', { cookie, body: { requestId: 'req-withdraw-02', id: push.id } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(t.pushes.length, 1);
});
