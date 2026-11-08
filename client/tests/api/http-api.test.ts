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

describe('真接口 · 请求形状', () => {
  it('发送：POST /v2/lines/main/messages，同源 cookie，JSON 体只有 requestId 和 text', async () => {
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

  it('翻页：GET 带 before 和 limit，回答里 hasMore 说还有没有更早的', async () => {
    const { api: http, calls } = api(() => json(200, { line: lineView(), messages: [lineMessage()], hasMore: true,
      queue: [] }));
    const page = await http.lines.read('main', { before: 12, limit: 50 });
    expect(calls[0]?.url).toBe('/v2/lines/main?before=12&limit=50');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.body).toBeUndefined();
    expect(page.hasMore).toBe(true);
  });

  it('保存笔记：PUT /v2/notes/:id 带 requestId 和 version；删除：DELETE 带 requestId 体', async () => {
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

  it('账号：建账号带本机令牌请求头；密码登录 POST /v2/session/password；改名 PATCH 后再读一次状态', async () => {
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

describe('真接口 · 回执不确定与幂等重试', () => {
  it('断网时发送算「结果待核实」；用同一 requestId 重发拿到存下的那一条，不出第二条', async () => {
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

  it('超时也算「结果待核实」，只发了一次，不自己重发', async () => {
    vi.useFakeTimers();
    const { api: http, calls } = api(hangs);
    const sending = http.lines.send('main', { requestId: REQUEST_ID, text: '一句' });
    const outcome = expect(sending).rejects.toMatchObject({ kind: 'uncertain' });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await outcome;
    await expect(sending).rejects.toThrow('连接超时');
    expect(calls).toHaveLength(1);
  });

  it('保存笔记断网：「结果待核实」，草稿那边再用同一 requestId 重发', async () => {
    const { api: http, calls } = api(
      () => new TypeError('network'),
      () => json(200, noteView({ version: 2 })),
    );
    const input = { requestId: REQUEST_ID, version: 1, markdown: '改过' };
    await expect(http.notes.save('note_1', input)).rejects.toMatchObject({ kind: 'uncertain' });
    expect((await http.notes.save('note_1', input)).version).toBe(2);
    expect(calls[1]?.body).toEqual(calls[0]?.body);
  });

  it('读操作断网是失败，不是待核实（什么都没改，再读就行）', async () => {
    const { api: http } = api(() => new TypeError('network'));
    await expect(http.lines.read('main', { limit: 50 })).rejects.toMatchObject({ kind: 'failed', code: 'network' });
  });

  it('调用方自己取消的请求照原样抛出，不算回执不确定', async () => {
    const { api: http } = api(hangs);
    const controller = new AbortController();
    const reading = http.lines.read('main', {}, controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('服务出错（500）的写操作算待核实；503 正在重启明说没收下，算失败、可以重发', async () => {
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

  it('别的 503（代理回的页面、或不是 shutting_down 的 code）不知道到没到服务：写操作仍是待核实', async () => {
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

  it('读操作碰上代理的 503：失败（什么都没改），不是待核实', async () => {
    const { api: http } = api(() => text(503, 'Service Unavailable'));
    await expect(http.lines.read('main', {})).rejects.toMatchObject({ kind: 'failed' });
  });
});

describe('真接口 · 401', () => {
  it('任何请求拿到 401：通知壳回到配对页，文案用服务端的', async () => {
    const { api: http, unauthorized } = api(() => json(401, UNAUTHORIZED));
    const reading = http.notes.list({});
    await expect(reading).rejects.toMatchObject({ kind: 'unauthorized', message: UNAUTHORIZED.error });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('读会话拿到 401 返回 null（还没配对），不当错误', async () => {
    const { api: http } = api(() => json(401, UNAUTHORIZED));
    expect(await http.session.current()).toBeNull();
  });

  it('密码不对（401 login_failed）只写原因，不当成会话失效', async () => {
    const body = { error: '密码不对。', code: 'login_failed', field: 'password' };
    const { api: http, unauthorized } = api(() => json(401, body));
    await expect(http.account.signIn({ password: 'nope', deviceName: 'Mac' })).rejects.toMatchObject({
      kind: 'invalid',
      message: '密码不对。',
    });
    expect(unauthorized).not.toHaveBeenCalled();
  });
});

describe('真接口 · 笔记 409', () => {
  it('保存冲突：把 currentVersion 和 current 交给冲突横幅', async () => {
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

  it('409 但不是带 current 的冲突（request_id 用在了别的操作上）：普通失败', async () => {
    const body = { error: '这个 request_id 已经用在另一个操作上了。', code: 'request_id_reused', field: 'requestId' };
    const { api: http } = api(() => json(409, body));
    const saving = http.notes.save('note_1', { requestId: REQUEST_ID, version: 3, markdown: 'x' });
    await expect(saving).rejects.toMatchObject({ kind: 'failed', code: 'request_id_reused' });
    await expect(saving).rejects.not.toBeInstanceOf(NoteConflictError);
  });
});

describe('真接口 · 回答先过 schema', () => {
  it('读操作的回答不合 schema：当格式错误，说出哪个字段不对', async () => {
    const { api: http } = api(() => json(200, { line: lineView(), messages: 'not a list', hasMore: false, queue: [] }));
    const reading = http.lines.read('main', {});
    await expect(reading).rejects.toMatchObject({ kind: 'failed', code: 'bad_response' });
    await expect(reading).rejects.toThrow('格式不对');
  });

  it('写操作的 2xx 不合 schema：已经生效但读不懂，算「结果待核实」', async () => {
    const { api: http } = api(() => json(202, { message: { id: 'msg_1' }, runId: null }));
    await expect(http.lines.send('main', { requestId: REQUEST_ID, text: '一句' })).rejects.toMatchObject({
      kind: 'uncertain',
      code: 'bad_response',
    });
  });

  it('回答不是 JSON（代理回的页面）：格式错误', async () => {
    const { api: http } = api(() => text(200, '<html>502</html>'));
    await expect(http.notes.get('note_1')).rejects.toMatchObject({ kind: 'failed', code: 'bad_response' });
  });

  it('错误回答不是约定格式：失败，带上状态码', async () => {
    const { api: http } = api(() => text(502, 'Bad Gateway'));
    const reading = http.notes.get('note_1');
    await expect(reading).rejects.toBeInstanceOf(ApiError);
    await expect(reading).rejects.toMatchObject({ kind: 'failed', status: 502 });
  });

  it('时间字段不是 ISO 时间也不收', async () => {
    const { api: http } = api(() => json(200, noteView({ updatedAt: '昨天' })));
    await expect(http.notes.get('note_1')).rejects.toMatchObject({ code: 'bad_response' });
  });
});

describe('真接口 · 笔记列表与本机事件', () => {
  it('列表翻完所有匹配页，搜索词交服务端查全文', async () => {
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

  it('服务端没有笔记事件：本机写成功后自己报 note.updated / note.deleted，事件流的订阅者收得到', async () => {
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

  it('写失败不报事件', async () => {
    const { api: http } = api(() => new TypeError('network'));
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    await expect(http.notes.create({ requestId: REQUEST_ID, markdown: '' })).rejects.toMatchObject({
      kind: 'uncertain',
    });
    expect(events).toEqual([]);
  });
});
