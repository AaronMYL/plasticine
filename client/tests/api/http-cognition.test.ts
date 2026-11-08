// 记忆、约定、设备钥匙的真实现：路径和请求体照 shared，409 带 current 交给界面对照，本人确认请求原样发送正文；
// 旧接口的 403 签名类错误不当成会话失效。事件流认 M3 的四种事件。

import { describe, expect, it, vi } from 'vitest';
import { agreementView, memoryEntryView } from '../../src/api/fake/cognition-views.ts';
import { ApiError, ConflictError } from '../../src/api/errors.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { FetchLike, ResponseLike } from '../../src/api/http/transport.ts';
import type { LiveEvent } from '../../src/api/types.ts';
import { eventSources, json } from './http-fixtures.ts';

interface RawCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyText: string | undefined;
}

function rawFetch(...answers: ResponseLike[]): { fetch: FetchLike; calls: RawCall[] } {
  const calls: RawCall[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      bodyText: typeof init.body === 'string' ? init.body : undefined,
    });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer === undefined) {
      throw new Error('假 fetch 没有准备回答');
    }
    return answer;
  };
  return { fetch, calls };
}

function api(...answers: ResponseLike[]) {
  const { fetch, calls } = rawFetch(...answers);
  const http = createHttpApi({ fetch, createEventSource: eventSources().create });
  const unauthorized = vi.fn();
  http.onUnauthorized(unauthorized);
  return { http, calls, unauthorized };
}

const ENTRY = memoryEntryView({ id: 'm 1', kind: 'interpretation', text: '你更信流水', version: 2 });

describe('真接口 · 记忆（旧条目只读）', () => {
  it('读一条整理前的原话：GET /v2/memory/entries/:id；改、删的方法没有了', async () => {
    const { http, calls } = api(json(200, { entry: ENTRY, history: [], disagreements: [] }));
    const detail = await http.memory.entry('m 1');
    expect(detail.entry.text).toBe('你更信流水');
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v2/memory/entries/m%201' });
    expect('edit' in http.memory).toBe(false);
    expect('archive' in http.memory).toBe(false);
  });
});

describe('真接口 · 本人确认请求', () => {
  const edited = agreementView({ id: 'a/1', text: '改好', version: 3 });
  const bodyText = '{"requestId":"req_abcdefgh","version":2,"text":"改好","scope":"范围"}';
  const send = {
    target: { kind: 'agreement_edit', agreementId: 'a/1' },
    bodyText,
    signedAt: '2026-10-27T02:00:00.000Z',
    signature: 'c2ln',
  } as const;

  it('按本人会话发送原样请求体，旧签名字段也不会生成签名头', async () => {
    const { http, calls } = api(json(200, { agreement: edited }));
    const result = await http.signed.send(send);
    expect(result).toEqual({ kind: 'agreement', agreement: edited });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/agreements/a%2F1/edit', bodyText });
    expect(calls[0]?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signed-at');
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signature');
  });

  it('403 签名类错误：带着服务端的 code 抛出，不通知壳回配对页', async () => {
    for (const code of ['signature_required', 'signature_invalid', 'signature_expired', 'device_key_missing']) {
      const { http, unauthorized } = api(json(403, { error: '签名不对，没有执行。', code, next: '重新签一次再发。' }));
      const failure = await http.signed.send(send).catch((e) => e);
      expect(failure).toMatchObject({ code, status: 403, kind: 'invalid' });
      expect(unauthorized).not.toHaveBeenCalled();
    }
  });

  it('确认约定：发往 /v2/agreements/:id/confirm，回答里的约定交出去', async () => {
    const agreement = agreementView({ id: 'a1', text: '对账先看差异', version: 2 });
    const { http, calls } = api(json(200, { agreement }));
    const target = { kind: 'agreement_confirm', agreementId: 'a1' } as const;
    expect(await http.signed.send({ ...send, target })).toEqual({ kind: 'agreement', agreement });
    expect(calls[0]?.url).toBe('/v2/agreements/a1/confirm');
  });

  it('登记设备钥匙：原样的请求体，回答里的钥匙交出去', async () => {
    const key = { id: 'k1', deviceId: 'dev_1', thumbprint: 'ab', createdAt: '2026-10-27T02:00:00.000Z' };
    const { http, calls } = api(json(201, { key }));
    const body = '{"requestId":"req_abcdefgh","publicKey":{"kty":"EC"}}';
    expect(await http.deviceKeys.register(body)).toEqual(key);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/device-keys', bodyText: body });
  });
});

describe('真事件流 · M3 的事件', () => {
  it('memory_entry_changed 原样换成界面的事件；认不出的那条当作补不上了', () => {
    const sources = eventSources();
    const http = createHttpApi({ fetch: rawFetch().fetch, createEventSource: sources.create });
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    const source = sources.created[0];
    if (source === undefined) {
      throw new Error('没有建 EventSource');
    }
    source.emit('memory_entry_changed', { type: 'memory_entry_changed', entry: ENTRY }, '7');
    source.emit('agreement_changed', { type: 'agreement_changed', agreement: { id: 'j' } }, '8');
    expect(events[0]).toEqual({ type: 'memory.changed', entry: ENTRY });
    expect(events[1]).toEqual({ type: 'resync' });
    expect(http.events.resumable()).toBe(true);
  });
});
