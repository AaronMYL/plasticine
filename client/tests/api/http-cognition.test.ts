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

describe('Real API - memory (legacy entries read-only)', () => {
  it('Reads pre-consolidation entry via GET /v2/memory/entries/:id; no edit/delete', async () => {
    const { http, calls } = api(json(200, { entry: ENTRY, history: [], disagreements: [] }));
    const detail = await http.memory.entry('m 1');
    expect(detail.entry.text).toBe('你更信流水');
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v2/memory/entries/m%201' });
    expect('edit' in http.memory).toBe(false);
    expect('archive' in http.memory).toBe(false);
  });
});

describe('Real API - user confirmation requests', () => {
  const switched = { id: 'inbox', label: '收件箱', description: '', tools: [], enabled: false, version: 3,
    confirmedAt: '2026-10-27T02:00:00.000Z' };
  const bodyText = '{"requestId":"req_abcdefgh","version":2,"enabled":false}';
  const send = {
    target: { kind: 'tool_group', groupId: 'in/box' },
    bodyText,
    signedAt: '2026-10-27T02:00:00.000Z',
    signature: 'c2ln',
  } as const;

  it('Sends raw body via user session without generating legacy signature headers', async () => {
    const { http, calls } = api(json(200, { group: switched }));
    const result = await http.signed.send(send);
    expect(result).toEqual({ kind: 'tool_group', group: switched });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/tool-groups/in%2Fbox', bodyText });
    expect(calls[0]?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signed-at');
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signature');
  });

  it('403 signature errors throw with server code without returning shell to pairing', async () => {
    for (const code of ['signature_required', 'signature_invalid', 'signature_expired']) {
      const { http, unauthorized } = api(json(403, { error: '签名不对，没有执行。', code, next: '重新签一次再发。' }));
      const failure = await http.signed.send(send).catch((e) => e);
      expect(failure).toMatchObject({ code, status: 403, kind: 'invalid' });
      expect(unauthorized).not.toHaveBeenCalled();
    }
  });
});

describe('Real event stream - M3 events', () => {
  it('Maps memory_entry_changed to UI event; unknown payload triggers resync', () => {
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
