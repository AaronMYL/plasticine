// 旧记忆条目和本人确认请求的真实现：路径和请求体照 shared，409 带 current 交给界面对照，本人确认请求原样发送正文；
// 旧接口的 403 签名类错误不当成会话失效。事件流认 M3 的四种事件。

import { describe, expect, it, vi } from 'vitest';
import { memoryEntryView } from '../../src/api/fake/cognition-views.ts';
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
  const switched = { id: 'inbox', label: '收件箱', description: '', tools: [], enabled: false, version: 3,
    confirmedAt: '2026-10-27T02:00:00.000Z' };
  const bodyText = '{"requestId":"req_abcdefgh","version":2,"enabled":false}';
  const send = {
    target: { kind: 'tool_group', groupId: 'in/box' },
    bodyText,
    signedAt: '2026-10-27T02:00:00.000Z',
    signature: 'c2ln',
  } as const;

  it('按本人会话发送原样请求体，旧签名字段也不会生成签名头', async () => {
    const { http, calls } = api(json(200, { group: switched }));
    const result = await http.signed.send(send);
    expect(result).toEqual({ kind: 'tool_group', group: switched });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/tool-groups/in%2Fbox', bodyText });
    expect(calls[0]?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signed-at');
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signature');
  });

  it('403 签名类错误：带着服务端的 code 抛出，不通知壳回配对页', async () => {
    for (const code of ['signature_required', 'signature_invalid', 'signature_expired']) {
      const { http, unauthorized } = api(json(403, { error: '签名不对，没有执行。', code, next: '重新签一次再发。' }));
      const failure = await http.signed.send(send).catch((e) => e);
      expect(failure).toMatchObject({ code, status: 403, kind: 'invalid' });
      expect(unauthorized).not.toHaveBeenCalled();
    }
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
    source.emit('memory_entry_changed', { type: 'memory_entry_changed', entry: { id: 'j' } }, '8');
    expect(events[0]).toEqual({ type: 'memory.changed', entry: ENTRY });
    expect(events[1]).toEqual({ type: 'resync' });
    expect(http.events.resumable()).toBe(true);
  });
});
