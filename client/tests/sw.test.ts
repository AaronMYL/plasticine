// client/public/sw.js 不经打包，原样放在站点根上。这里把它当一段脚本跑在假的 service worker 全局里，
// 看 push 只显示服务端给的 title / body、点开只跳本站的路径。

import { describe, expect, it, vi } from 'vitest';
import source from '../public/sw.js?raw';

type Listener = (event: unknown) => void;

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

/** 假的 CacheStorage：只记 put 过的请求路径和 open 过的缓存名。 */
function fakeCaches() {
  const stores = new Map<string, Map<string, unknown>>();
  const cacheOf = (name: string) => {
    const store = stores.get(name) ?? new Map<string, unknown>();
    stores.set(name, store);
    return {
      put: vi.fn(async (request: string, response: unknown) => { store.set(request, response); }),
      match: vi.fn(async (request: string) => store.get(request)),
    };
  };
  return {
    stores,
    open: vi.fn(async (name: string) => cacheOf(name)),
    keys: vi.fn(async () => [...stores.keys()]),
    delete: vi.fn(async (name: string) => stores.delete(name)),
    match: vi.fn(async (request: string) => {
      for (const store of stores.values()) {
        if (store.has(request)) { return store.get(request); }
      }
      return undefined;
    }),
  };
}

function worker(clients: FakeClient[] = [], fetch: ReturnType<typeof vi.fn> = vi.fn()) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => null);
  const caches = fakeCaches();
  const self = {
    location: { origin: 'https://plasticine.example' },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => clients), openWindow, claim: vi.fn(async () => undefined) },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    caches,
    fetch,
  };
  // 和浏览器加载 service worker 一样：脚本顶层就是 self 上的那些全局。
  new Function('self', 'caches', 'fetch', source)(self, caches, fetch);
  const fire = async (type: string, event: Record<string, unknown>): Promise<unknown> => {
    let pending: Promise<unknown> = Promise.resolve();
    let responded: Promise<unknown> | undefined;
    listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise),
      respondWith: (promise: Promise<unknown>) => { responded = promise; } });
    await pending;
    return responded === undefined ? undefined : await responded;
  };
  return { fire, showNotification, openWindow, caches, fetch, listeners };
}

function pushData(value: unknown) {
  return { data: { json: () => value } };
}

describe('service worker · 立刻打断的系统通知', () => {
  it('push：只显示服务端给的 title / body，带上 tag 和站内链接，别的字段不显示', async () => {
    const { fire, showNotification } = worker();
    await fire('push', pushData({ title: '要你定', body: '有一件事要你马上定。', url: '/#/tasks', tag: 'ask_1', question: '秘密' }));
    expect(showNotification).toHaveBeenCalledWith('要你定', {
      body: '有一件事要你马上定。',
      tag: 'ask_1',
      data: { url: '/#/tasks' },
    });
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain('秘密');
  });

  it('push 不是 JSON 或少了字段：显示固定的一句，不把收到的东西贴出来', async () => {
    const { fire, showNotification } = worker();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await fire('push', {
      data: {
        json: () => {
          throw new SyntaxError('坏的');
        },
      },
    });
    expect(showNotification).toHaveBeenLastCalledWith('Plasticine', {
      body: '有一件事要你马上看。',
      tag: undefined,
      data: { url: '/' },
    });
  });

  it('载荷整体对不上推送协议（缺字段、类型错）：整条用固定的话，不显示半截载荷里的正文', async () => {
    const { fire, showNotification } = worker();
    const broken = [
      { body: '缺了 title 的正文', url: '/#/tasks', tag: 'x' },
      { title: '要你定', body: '缺了 url', tag: 'x' },
      { title: '要你定', body: '没有 tag', url: '/#/tasks' },
      { title: 42, body: 'title 不是字符串', url: '/', tag: 'x' },
      { title: '要你定', body: ['不是字符串'], url: '/', tag: 'x' },
      { title: '要你定', body: '正文', url: 7, tag: 'x' },
      '一整条字符串',
    ];
    for (const payload of broken) {
      await fire('push', pushData(payload));
    }
    for (const call of showNotification.mock.calls as unknown as Array<[string, unknown]>) {
      expect(call).toEqual(['Plasticine', { body: '有一件事要你马上看。', tag: undefined, data: { url: '/' } }]);
    }
    expect(showNotification).toHaveBeenCalledTimes(broken.length);
  });

  it('url 不是本站的路径（别的网站、//开头）：一律回首页', async () => {
    const { fire, showNotification } = worker();
    await fire('push', pushData({ title: 't', body: 'b', url: 'https://evil.example/', tag: 'x' }));
    await fire('push', pushData({ title: 't', body: 'b', url: '//evil.example/', tag: 'x' }));
    for (const call of showNotification.mock.calls as unknown as Array<[string, { data: { url: string } }]>) {
      expect(call[1].data.url).toBe('/');
    }
  });

  it('反斜杠、夹着的制表符和换行（解析后会变成 //外站）：解析之后核对 origin，一律回首页', async () => {
    const { fire, showNotification } = worker();
    for (const url of ['/\\evil.example/', '/\t/evil.example/', '/\n/evil.example/', '/\\\\evil.example']) {
      await fire('push', pushData({ title: 't', body: 'b', url, tag: 'x' }));
    }
    const urls = (showNotification.mock.calls as unknown as Array<[string, { data: { url: string } }]>).map(
      (call) => call[1].data.url,
    );
    expect(urls).toEqual(['/', '/', '/', '/']);
  });

  it('本站路径带查询和 # 段：原样留着', async () => {
    const { fire, showNotification } = worker();
    await fire('push', pushData({ title: 't', body: 'b', url: '/?from=push#/tasks', tag: 'x' }));
    expect(showNotification).toHaveBeenCalledWith('t', { body: 'b', tag: 'x', data: { url: '/?from=push#/tasks' } });
  });

  it('点开通知：关掉它，回到开着的 Plasticine 并跳到那一页；没有开着的就新开一个', async () => {
    const client: FakeClient = { url: 'https://plasticine.example/#/today', focus: vi.fn(), navigate: vi.fn() };
    const open = worker([client]);
    const close = vi.fn();
    await open.fire('notificationclick', { notification: { close, data: { url: '/#/tasks' } } });
    expect(close).toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled();
    expect(client.navigate).toHaveBeenCalledWith('https://plasticine.example/#/tasks');

    const empty = worker([]);
    await empty.fire('notificationclick', { notification: { close: vi.fn(), data: { url: '/#/tasks' } } });
    expect(empty.openWindow).toHaveBeenCalledWith('https://plasticine.example/#/tasks');
  });
});

// 离线兜底（用户视角审查 2026-11-01 第 16 条 ③，第 92 条：/sw.js 不缓存、更新机制不变）：只预缓存 offline.html，
// fetch 只拦导航请求，网络失败才回 offline.html；别的请求一律不拦、不缓存。
describe('service worker · 离线兜底', () => {
  it('install 时只把 offline.html 放进缓存，别的什么都不预缓存', async () => {
    const response = { ok: true, clone: () => 'offline-copy' };
    const { fire, caches, fetch } = worker([], vi.fn(async () => response));
    await fire('install', {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/offline.html');
    const [name, store] = [...caches.stores.entries()][0]!;
    expect(name).toMatch(/offline/);
    expect([...store.keys()]).toEqual(['/offline.html']);
  });

  it('导航请求：网络通就原样给网络的回答，不写缓存；断网就回缓存里的 offline.html', async () => {
    const online: unknown = { ok: true, clone: () => 'offline-copy' };
    const fetch = vi.fn(async (): Promise<unknown> => online);
    const { fire, caches } = worker([], fetch);
    await fire('install', {});
    const page = { status: 200, body: '真页面' };
    fetch.mockResolvedValueOnce(page);
    const request = { mode: 'navigate', url: 'https://plasticine.example/#/notes' };
    expect(await fire('fetch', { request })).toBe(page);
    expect([...caches.stores.values()].flatMap((store) => [...store.keys()])).toEqual(['/offline.html']);
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await fire('fetch', { request })).toBe('offline-copy');
  });

  it('不是导航的请求（接口、/sw.js、资源）一律不拦：不 respondWith、不碰缓存', async () => {
    const { fire, caches, fetch } = worker([], vi.fn(async () => ({ ok: true, clone: () => 'x' })));
    await fire('install', {});
    fetch.mockClear();
    for (const url of ['https://plasticine.example/v2/tasks', 'https://plasticine.example/sw.js',
      'https://plasticine.example/assets/main.js']) {
      expect(await fire('fetch', { request: { mode: 'cors', url } })).toBeUndefined();
      expect(await fire('fetch', { request: { mode: 'no-cors', url } })).toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(caches.match).not.toHaveBeenCalled();
  });

  it('断网又没有缓存（install 时就没下到）：回一个本站的 503 文本，不让导航悬着', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { fire } = worker([], fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await fire('install', {});
    const result = await fire('fetch', { request: { mode: 'navigate', url: 'https://plasticine.example/' } });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
  });
});
