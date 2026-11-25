import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NoteConflictError } from '../../src/api/errors.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import { REQUEST_TIMEOUT_MS } from '../../src/api/http/transport.ts';
import { toMeta } from '../../src/api/note-meta.ts';
import type { LiveEvent } from '../../src/api/types.ts';
import {
  AT,
  eventSources,
  fakeFetch,
  hangs,
  json,
  lineMessage,
  lineView,
  sentResponse,
  noteView,
  text,
  type Responder,
} from './http-fixtures.ts';

const REQUEST_ID = 'req_00000001';

function api(...responders: Responder[]) {
  const { fetch, calls } = fakeFetch(...responders);
  const sources = eventSources();
  const unauthorized = vi.fn();
  const instance = createHttpApi({ fetch, createEventSource: sources.create });
  instance.onUnauthorized(unauthorized);
  return { api: instance, calls, sources, unauthorized };
}

const UNAUTHORIZED = { error: '这台设备还没登录，或者登录已失效。', code: 'unauthorized', next: '在服务器上运行配对脚本。' };

afterEach(() => {
  vi.useRealTimers();
});

describe('Real API - request shapes', () => {
  it('Send: POST /v2/lines/main/messages with cookie and JSON { requestId, text }', async () => {
    const { api: http, calls } = api(() => json(200, sentResponse()));
    const response = await http.lines.send('main', { requestId: REQUEST_ID, text: '一句' });
    expect(response.outcome).toBe('started');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: '/v2/lines/main/messages',
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: { requestId: REQUEST_ID, text: '一句' },
    });
  });

  it('Pagination: GET with before and limit; response hasMore indicates older items', async () => {
    const { api: http, calls } = api(() => json(200, { line: lineView(), messages: [lineMessage()], hasMore: true,
      queue: [] }));
    const page = await http.lines.read('main', { before: 12, limit: 50 });
    expect(calls[0]?.url).toBe('/v2/lines/main?before=12&limit=50');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBeUndefined();
    expect(page.hasMore).toBe(true);
  });

  it('Note save: PUT /v2/notes/:id with requestId/version; delete: DELETE w/ requestId', async () => {
    const { api: http, calls } = api(
      () => json(200, noteView({ version: 2 })),
      () => json(200, noteView({ deletedAt: AT })),
    );
    await http.notes.save('note/1', { requestId: REQUEST_ID, version: 1, markdown: '改过' });
    await http.notes.remove('note/1', 'req_00000002');
    expect(calls[0]).toMatchObject({
      url: '/v2/notes/note%2F1',
      method: 'PUT',
      body: { requestId: REQUEST_ID, version: 1, markdown: '改过' },
    });
    expect(calls[1]).toMatchObject({
      url: '/v2/notes/note%2F1',
      method: 'DELETE',
      body: { requestId: 'req_00000002' },
    });
  });

  it('Account: setup with local token header, password login POST, rename PATCH+read', async () => {
    const session = {
      device: { id: 'dev_1', name: 'Mac', firstSeenAt: AT, lastSeenAt: AT, revokedAt: null, current: true },
      session: { createdAt: AT, expiresAt: AT },
    };
    const state = { setup: 'done', handle: 'alex', displayName: 'Alex', passwordSet: true,
      networkUrl: 'https://alex.cyberhunter.top' };
    const { api: http, calls } = api(
      () => json(201, { session, network: { joined: true, url: state.networkUrl, problem: null } }),
      () => json(201, session),
      () => json(200, { ok: true }),
      () => json(200, state),
      () => json(200, { handle: 'alex', available: true, reason: null }),
    );
    const setup = { displayName: 'Alex', handle: 'alex', password: 'fake-pass-1234', deviceName: 'Mac' };
    await http.account.setup(setup, 'fake-local-token');
    expect(calls[0]).toMatchObject({ url: '/v2/account/setup', method: 'POST', body: setup });
    expect(calls[0]?.headers['x-plasticine-local-token']).toBe('fake-local-token');
    expect(await http.account.signIn({ password: 'fake-password', deviceName: 'Mac' })).toEqual(session);
    expect(calls[1]).toMatchObject({ url: '/v2/session/password', method: 'POST' });
    expect(calls[1]?.headers['x-plasticine-local-token']).toBeUndefined();
    expect(await http.account.rename('Alex')).toEqual(state);
    expect(calls[2]).toMatchObject({ url: '/v2/account', method: 'PATCH', body: { displayName: 'Alex' } });
    expect(calls[3]).toMatchObject({ url: '/v2/account/state', method: 'GET' });
    await http.account.handle('alex');
    expect(calls[4]).toMatchObject({ url: '/v2/account/handles/alex', method: 'GET' });
  });
});

describe('Real API - uncertain receipt and idempotent retry', () => {
  it('Offline send marks unverified; retry with same requestId returns stored message', async () => {
    const stored = lineMessage();
    const { api: http, calls } = api(
      () => new TypeError('Failed to fetch'),
      () => json(200, sentResponse(stored)),
    );
    const input = { requestId: REQUEST_ID, text: '一句' };
    await expect(http.lines.send('main', input)).rejects.toMatchObject({ kind: 'uncertain', code: 'receipt_unknown' });
    const again = await http.lines.send('main', input);
    expect(again.message).toEqual(stored);
    expect(calls.map((call) => call.body)).toEqual([input, input]);
  });

  it('Timeout marks unverified after single attempt without auto-retrying', async () => {
    vi.useFakeTimers();
    const { api: http, calls } = api(hangs);
    const sending = http.lines.send('main', { requestId: REQUEST_ID, text: '一句' });
    const outcome = expect(sending).rejects.toMatchObject({ kind: 'uncertain' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
    await expect(sending).rejects.toThrow('连接超时');
    expect(calls).toHaveLength(1);
  });

  it('Offline note save marks unverified so draft retries with the same requestId', async () => {
    const { api: http, calls } = api(
      () => new TypeError('network'),
      () => json(200, noteView({ version: 2 })),
    );
    const input = { requestId: REQUEST_ID, version: 1, markdown: '改过' };
    await expect(http.notes.save('note_1', input)).rejects.toMatchObject({ kind: 'uncertain' });
    expect((await http.notes.save('note_1', input)).version).toBe(2);
    expect(calls[1]?.body).toEqual(calls[0]?.body);
  });

  it('Offline read fails directly rather than unverified since nothing changed', async () => {
    const { api: http } = api(() => new TypeError('network'));
    await expect(http.lines.read('main', { limit: 50 })).rejects.toMatchObject({ kind: 'failed', code: 'network' });
  });

  it('Caller-aborted request rethrows as-is instead of uncertain receipt', async () => {
    const { api: http } = api(hangs);
    const controller = new AbortController();
    const reading = http.lines.read('main', {}, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('500 on write marks unverified; 503 shutting_down fails cleanly as retryable', async () => {
    const internal = { error: '服务出错了，这次操作不确定有没有完成。', code: 'internal_error', next: '稍后刷新看看结果。' };
    const shutting = { error: '服务正在重启，这条消息没有收下。', code: 'shutting_down', next: '稍后重发。' };
    const { api: http } = api(() => json(500, internal), () => json(503, shutting));
    await expect(http.lines.send('main', { requestId: REQUEST_ID, text: '一句' })).rejects.toMatchObject({
      kind: 'uncertain',
      message: internal.error,
    });
    await expect(http.lines.send('main', { requestId: REQUEST_ID, text: '一句' })).rejects.toMatchObject({
      kind: 'failed',
      code: 'shutting_down',
    });
  });

  it('Other 503 (proxy page or non-shutting_down) on write stays unverified', async () => {
    const overloaded = { error: '忙不过来。', code: 'overloaded' };
    const { api: http } = api(
      () => text(503, '<html>Service Unavailable</html>'),
      () => json(503, overloaded),
    );
    await expect(http.lines.send('main', { requestId: REQUEST_ID, text: '一句' })).rejects.toMatchObject({
      kind: 'uncertain',
    });
    await expect(http.lines.send('main', { requestId: REQUEST_ID, text: '一句' })).rejects.toMatchObject({
      kind: 'uncertain',
      code: 'overloaded',
    });
  });

  it('Proxy 503 on read fails cleanly rather than unverified', async () => {
    const { api: http } = api(() => text(503, 'Service Unavailable'));
    await expect(http.lines.read('main', {})).rejects.toMatchObject({ kind: 'failed' });
  });
});

describe('Real API - 401', () => {
  it('Any 401 notifies shell to return to pairing page with server message', async () => {
    const { api: http, unauthorized } = api(() => json(401, UNAUTHORIZED));
    const reading = http.notes.list({});
    await expect(reading).rejects.toMatchObject({ kind: 'unauthorized', message: UNAUTHORIZED.error });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('401 on session check returns null (unpaired) instead of throwing', async () => {
    const { api: http } = api(() => json(401, UNAUTHORIZED));
    expect(await http.session.current()).toBeNull();
  });

  it('Wrong password (401 login_failed) surfaces reason without invalidating session', async () => {
    const body = { error: '密码不对。', code: 'login_failed', field: 'password' };
    const { api: http, unauthorized } = api(() => json(401, body));
    await expect(http.account.signIn({ password: 'nope', deviceName: 'Mac' })).rejects.toMatchObject({
      kind: 'invalid',
      message: '密码不对。',
    });
    expect(unauthorized).not.toHaveBeenCalled();
  });
});

describe('Real API - note 409', () => {
  it('Save conflict passes currentVersion and current note to conflict banner', async () => {
    const current = noteView({ version: 5, markdown: '# 别处的版本' });
    const body = {
      error: '这篇笔记在别处改过了。',
      code: 'version_conflict',
      currentVersion: 5,
      next: '对照 current 里的最新版合并后再保存。',
      current,
    };
    const { api: http } = api(() => json(409, body));
    const saving = http.notes.save('note_1', { requestId: REQUEST_ID, version: 3, markdown: '我的版本' });
    await expect(saving).rejects.toBeInstanceOf(NoteConflictError);
    const error = await saving.catch((cause: unknown) => cause);
    expect(error instanceof NoteConflictError ? [error.currentVersion, error.current] : null).toEqual([5, current]);
  });

  it('409 without current payload (reused request_id) surfaces as normal failure', async () => {
    const body = { error: '这个 request_id 已经用在另一个操作上了。', code: 'request_id_reused', field: 'requestId' };
    const { api: http } = api(() => json(409, body));
    const saving = http.notes.save('note_1', { requestId: REQUEST_ID, version: 3, markdown: 'x' });
    await expect(saving).rejects.toMatchObject({ kind: 'failed', code: 'request_id_reused' });
    await expect(saving).rejects.not.toBeInstanceOf(NoteConflictError);
  });
});

describe('Real API - schema validation', () => {
  it('Schema-invalid read response fails as format error naming the bad field', async () => {
    const { api: http } = api(() => json(200, { line: lineView(), messages: 'not a list', hasMore: false, queue: [] }));
    const reading = http.lines.read('main', {});
    await expect(reading).rejects.toMatchObject({ kind: 'failed', code: 'bad_response' });
    await expect(reading).rejects.toThrow('格式不对');
  });

  it('Schema-invalid 2xx write response marks unverified since effect is unknown', async () => {
    const { api: http } = api(() => json(202, { message: { id: 'msg_1' }, runId: null }));
    await expect(http.lines.send('main', { requestId: REQUEST_ID, text: '一句' })).rejects.toMatchObject({
      kind: 'uncertain',
      code: 'bad_response',
    });
  });

  it('Non-JSON response (e.g. proxy HTML) fails as format error', async () => {
    const { api: http } = api(() => text(200, '<html>502</html>'));
    await expect(http.notes.get('note_1')).rejects.toMatchObject({ kind: 'failed', code: 'bad_response' });
  });

  it('Non-standard error payload fails carrying the HTTP status code', async () => {
    const { api: http } = api(() => text(502, 'Bad Gateway'));
    const reading = http.notes.get('note_1');
    await expect(reading).rejects.toBeInstanceOf(ApiError);
    await expect(reading).rejects.toMatchObject({ kind: 'failed', status: 502 });
  });

  it('Rejects non-ISO timestamp fields', async () => {
    const { api: http } = api(() => json(200, noteView({ updatedAt: '昨天' })));
    await expect(http.notes.get('note_1')).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('Real API - note list and local events', () => {
  it('List fetches all matching pages and delegates full-text search to server', async () => {
    const metaA = toMeta(noteView({ id: 'a', title: '读书摘记', preview: '关于时间' }));
    const first = { notes: [metaA], nextOffset: 400 };
    const second = { notes: [toMeta(noteView({ id: 'b', title: '购物', preview: '牛奶' }))], nextOffset: null };
    const { api: http, calls } = api(
      () => json(200, first),
      () => json(200, second),
      () => json(200, { notes: [metaA], nextOffset: null }),
    );
    expect((await http.notes.list({})).map((note) => note.id)).toEqual(['a', 'b']);
    expect(await http.notes.list({ q: '时间' })).toEqual([metaA]);
    expect(calls[2]?.url).toBe('/v2/notes?q=%E6%97%B6%E9%97%B4&limit=400&offset=0');
    expect(calls.slice(0, 2).map((call) => call.url)).toEqual([
      '/v2/notes?limit=400&offset=0',
      '/v2/notes?limit=400&offset=400',
    ]);
  });

  it('Emits local note.updated / note.deleted on write success to event subscribers', async () => {
    const { api: http, sources } = api(
      () => json(201, noteView()),
      () => json(200, noteView({ version: 2 })),
      () => json(200, noteView({ deletedAt: AT })),
    );
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    expect(sources.created).toHaveLength(1);
    await http.notes.create({ requestId: REQUEST_ID, markdown: '# 计划' });
    await http.notes.save('note_1', { requestId: 'req_00000002', version: 1, markdown: '# 计划\n\n改过' });
    await http.notes.remove('note_1', 'req_00000003');
    expect(events.map((event) => event.type)).toEqual(['note.updated', 'note.updated', 'note.deleted']);
  });

  it('Failed note write does not emit local events', async () => {
    const { api: http } = api(() => new TypeError('network'));
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    await expect(http.notes.create({ requestId: REQUEST_ID, markdown: '' })).rejects.toMatchObject({
      kind: 'uncertain',
    });
    expect(events).toEqual([]);
  });
});
