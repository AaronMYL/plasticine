import { describe, expect, it, vi } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import { FAKE_VAPID_PUBLIC_KEY } from '../../src/api/fake/fake-push.ts';
import { AT, askView, eventSources, fakeFetch, json, type Responder } from './http-fixtures.ts';

const ENDPOINT = 'https://push.example.test/send/abc';
const KEYS = { p256dh: `BB${'C'.repeat(85)}`, auth: 'D'.repeat(22) };

function api(...responders: Responder[]) {
  const { fetch, calls } = fakeFetch(...responders);
  const unauthorized = vi.fn();
  const instance = createHttpApi({ fetch, createEventSource: eventSources().create });
  instance.onUnauthorized(unauthorized);
  return { http: instance, calls, unauthorized };
}

describe('真接口 · 要你定卡', () => {
  it('作答：POST /v2/asks/:id/answer 带 requestId 和选项；回来的是收起的卡', async () => {
    const answered = askView({ status: 'answered', version: 2, lineId: 'line-main' });
    const { http, calls } = api(() => json(200, { ask: answered }));
    const response = await http.asks.answer('ask_1', { requestId: 'req_00000009', optionId: 'fix' });
    expect(response.ask.lineId).toBe('line-main');
    expect(calls[0]).toMatchObject({
      url: '/v2/asks/ask_1/answer',
      method: 'POST',
      body: { requestId: 'req_00000009', optionId: 'fix' },
    });
  });

  it('已经答过（409 ask_closed）：明确失败，文案是服务端那句', async () => {
    const closed = { error: '这张卡已经答过了。', code: 'ask_closed' };
    const { http } = api(() => json(409, closed));
    await expect(http.asks.answer('ask_1', { requestId: 'req_00000009', optionId: 'fix' })).rejects.toMatchObject({
      kind: 'failed',
      code: 'ask_closed',
      message: closed.error,
    });
  });

  it('先不、问一句、列表：路径和体', async () => {
    const { http, calls } = api(
      () => json(200, { ask: askView({ deferredAt: AT, version: 2 }) }),
      () => json(200, { lineId: 'line-main', outcome: 'started' }),
      () => json(200, { current: askView(), queue: [] }),
    );
    await http.asks.defer('ask_1', { requestId: 'req_00000010' });
    await http.asks.ask('ask_1', { requestId: 'req_00000011', text: '为什么是这 3 笔？' });
    const board = await http.asks.list();
    expect(board.current?.id).toBe('ask_1');
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST /v2/asks/ask_1/defer',
      'POST /v2/asks/ask_1/ask',
      'GET /v2/asks',
    ]);
    expect(calls[1]?.body).toEqual({ requestId: 'req_00000011', text: '为什么是这 3 笔？' });
  });
});

describe('真接口 · 系统通知', () => {
  it('公钥、订阅、退订：路径、方法和体', async () => {
    const subscription = { id: 'push_1', endpointHost: 'push.example.test', createdAt: AT, lastSentAt: null };
    const { http, calls } = api(
      () => json(200, { publicKey: FAKE_VAPID_PUBLIC_KEY }),
      () => json(201, { subscription }),
      () => json(200, { removed: true }),
    );
    expect((await http.push.key()).publicKey).toBe(FAKE_VAPID_PUBLIC_KEY);
    await http.push.subscribe({ requestId: 'req_00000012', endpoint: ENDPOINT, keys: KEYS });
    expect((await http.push.unsubscribe({ requestId: 'req_00000013', endpoint: ENDPOINT })).removed).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /v2/push/key',
      'POST /v2/push/subscriptions',
      'DELETE /v2/push/subscriptions',
    ]);
    expect(calls[1]?.body).toEqual({ requestId: 'req_00000012', endpoint: ENDPOINT, keys: KEYS });
  });

  it('公钥格式不对：不拿来订阅', async () => {
    const { http } = api(() => json(200, { publicKey: 'short' }));
    await expect(http.push.key()).rejects.toMatchObject({ code: 'bad_response' });
  });
});
