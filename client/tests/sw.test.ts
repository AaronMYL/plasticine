import { describe, expect, it, vi } from 'vitest';
import source from '../public/sw.js?raw';

type Listener = (event: unknown) => void;

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

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

function worker(clients: FakeClient[] = [], fetch: ReturnType<typeof vi.fn> = vi.fn(), shownTags: string[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => undefined);
  const getNotifications = vi.fn(async ({ tag }: { tag: string }) => (shownTags.includes(tag) ? [{ tag }] : []));
  const openWindow = vi.fn(async () => null);
  const caches = fakeCaches();
  const self = {
    location: { origin: 'https://plasticine.example' },
    registration: { showNotification, getNotifications },
    clients: { matchAll: vi.fn(async () => clients), openWindow, claim: vi.fn(async () => undefined) },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => undefined),
    caches,
    fetch,
  };
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

describe('service worker: urgent interrupt notifications', () => {
  it('push shows only server title/body with tag and in-app link, ignoring extra fields', async () => {
    const { fire, showNotification } = worker();
    await fire('push', pushData({ title: '要你定', body: '有一件事要你马上定。', url: '/#/tasks', tag: 'ask_1', question: '秘密' }));
    expect(showNotification).toHaveBeenCalledWith('要你定', {
      body: '有一件事要你马上定。',
      tag: 'ask_1',
      data: { url: '/#/tasks' },
    });
    expect(JSON.stringify(showNotification.mock.calls)).not.toContain('秘密');
  });

  it('replaces existing notification with same tag silently without re-alerting', async () => {
    const { fire, showNotification } = worker([], vi.fn(), ['push:p1']);
    await fire('push', pushData({ title: 'Plasticine', body: '「示例」这条推送已撤回', url: '/#/plasticine',
      tag: 'push:p1' }));
    expect(showNotification).toHaveBeenCalledWith('Plasticine', { body: '「示例」这条推送已撤回', tag: 'push:p1',
      data: { url: '/#/plasticine' }, silent: true });
  });

  it('non-JSON or incomplete push shows fallback copy without echoing raw payload', async () => {
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

  it('schema-invalid push uses fallback copy without showing partial payload body', async () => {
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

  it('off-origin or protocol-relative URLs fall back to home', async () => {
    const { fire, showNotification } = worker();
    await fire('push', pushData({ title: 't', body: 'b', url: 'https://evil.example/', tag: 'x' }));
    await fire('push', pushData({ title: 't', body: 'b', url: '//evil.example/', tag: 'x' }));
    for (const call of showNotification.mock.calls as unknown as Array<[string, { data: { url: string } }]>) {
      expect(call[1].data.url).toBe('/');
    }
  });

  it('backslash/tab/newline tricks resolving off-origin fail origin check and fall back to home', async () => {
    const { fire, showNotification } = worker();
    for (const url of ['/\\evil.example/', '/\t/evil.example/', '/\n/evil.example/', '/\\\\evil.example']) {
      await fire('push', pushData({ title: 't', body: 'b', url, tag: 'x' }));
    }
    const urls = (showNotification.mock.calls as unknown as Array<[string, { data: { url: string } }]>).map(
      (call) => call[1].data.url,
    );
    expect(urls).toEqual(['/', '/', '/', '/']);
  });

  it('same-origin path with query and hash fragment is preserved', async () => {
    const { fire, showNotification } = worker();
    await fire('push', pushData({ title: 't', body: 'b', url: '/?from=push#/tasks', tag: 'x' }));
    expect(showNotification).toHaveBeenCalledWith('t', { body: 'b', tag: 'x', data: { url: '/?from=push#/tasks' } });
  });

  it('clicking notification closes it, focuses existing window and navigates, or opens new one', async () => {
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

describe('service worker: offline fallback', () => {
  it('install precaches only offline.html and nothing else', async () => {
    const response = { ok: true, clone: () => 'offline-copy' };
    const { fire, caches, fetch } = worker([], vi.fn(async () => response));
    await fire('install', {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('/offline.html');
    const [name, store] = [...caches.stores.entries()][0]!;
    expect(name).toMatch(/offline/);
    expect([...store.keys()]).toEqual(['/offline.html']);
  });

  it('navigation serves live network response without caching, falling back to offline.html', async () => {
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

  it('non-navigation requests (API, /sw.js, assets) bypass respondWith and cache', async () => {
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

  it('offline without cached offline.html returns local 503 text instead of hanging', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const { fire } = worker([], fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await fire('install', {});
    const result = await fire('fetch', { request: { mode: 'navigate', url: 'https://plasticine.example/' } });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(503);
  });
});

describe('service worker: direct channel', () => {
  type PageReply = (message: { method: string; path: string; body: ArrayBuffer | null }, port: MessagePort) => void;

  function directWorker(reply: PageReply | null, network = vi.fn(async () => new Response('经中继'))) {
    const page = {
      id: 'page-1',
      postMessage: vi.fn((message: { method: string; path: string; body: ArrayBuffer | null },
        transfer: MessagePort[]) => {
        if (reply !== null) reply(message, transfer[0]!);
      }),
    };
    const listeners = new Map<string, Listener>();
    const self = {
      location: { origin: 'https://alex.cyberhunter.top' },
      registration: { showNotification: vi.fn() },
      clients: { get: vi.fn(async (id: string) => (id === page.id ? page : undefined)), matchAll: vi.fn(),
        claim: vi.fn(async () => undefined) },
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      skipWaiting: vi.fn(async () => undefined),
    };
    new Function('self', 'caches', 'fetch', source)(self, fakeCaches(), network);
    const fetchEvent = async (request: Request, clientId = page.id): Promise<Response | undefined> => {
      let responded: Promise<Response> | undefined;
      listeners.get('fetch')?.({ request, clientId,
        respondWith: (promise: Promise<Response>) => { responded = promise; } });
      return responded === undefined ? undefined : await responded;
    };
    return { fetchEvent, page, network };
  }

  const answer: PageReply = (message, port) => {
    port.postMessage({ type: 'ack' });
    port.postMessage({ type: 'head', status: 200, headers: { 'content-type': 'application/json' } });
    const bytes = new TextEncoder().encode(JSON.stringify({ via: 'direct', path: message.path }));
    port.postMessage({ type: 'chunk', data: bytes.buffer });
    port.postMessage({ type: 'end' });
  };

  it('serves response from open page direct channel without hitting network', async () => {
    const { fetchEvent, network } = directWorker(answer);
    const response = await fetchEvent(new Request('https://alex.cyberhunter.top/v2/lines?limit=5'));
    expect(await response?.json()).toEqual({ via: 'direct', path: '/v2/lines?limit=5' });
    expect(network).not.toHaveBeenCalled();
  });

  it('falls back to network if channel closed and stops querying unresponsive pages', async () => {
    const fallback = directWorker((_message, port) => {
      port.postMessage({ type: 'ack' });
      port.postMessage({ type: 'fallback', sent: false });
    });
    expect(await (await fallback.fetchEvent(new Request('https://alex.cyberhunter.top/v2/lines')))?.text())
      .toBe('经中继');
    const deaf = directWorker(null);
    expect(await (await deaf.fetchEvent(new Request('https://alex.cyberhunter.top/v2/lines')))?.text())
      .toBe('经中继');
    expect(await deaf.fetchEvent(new Request('https://alex.cyberhunter.top/v2/lines'))).toBeUndefined();
    expect(deaf.page.postMessage).toHaveBeenCalledTimes(1);
  });

  it('write errors on channel do not fall back to network; read errors fall back to network', async () => {
    const broken: PageReply = (_message, port) => {
      port.postMessage({ type: 'ack' });
      port.postMessage({ type: 'error' });
    };
    const write = directWorker(broken);
    const response = await write.fetchEvent(new Request('https://alex.cyberhunter.top/v2/notes', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: '{"title":"t"}' }));
    expect(response?.type).toBe('error');
    expect(write.network).not.toHaveBeenCalled();
    const read = directWorker(broken);
    expect(await (await read.fetchEvent(new Request('https://alex.cyberhunter.top/v2/notes')))?.text()).toBe('经中继');
  });

  it('skips page channel for auth, account, handshake, upload, cross-origin, or clientless calls', async () => {
    const { fetchEvent, page } = directWorker(answer);
    for (const request of [new Request('https://alex.cyberhunter.top/v2/session/password', { method: 'POST' }),
      new Request('https://alex.cyberhunter.top/v2/account/state'),
      new Request('https://alex.cyberhunter.top/v2/direct/offer', { method: 'POST' }),
      new Request('https://alex.cyberhunter.top/v2/attachments', { method: 'POST',
        headers: { 'content-type': 'application/octet-stream' }, body: 'x' }),
      new Request('https://other.example/v2/lines')]) {
      expect(await fetchEvent(request)).toBeUndefined();
    }
    expect(await fetchEvent(new Request('https://alex.cyberhunter.top/v2/lines'), '')).toBeUndefined();
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it('direct-excluded endpoints match agent/shared/api/direct.ts', async () => {
    const { DIRECT_EXCLUDED_PREFIXES } = await import('../src/api/shared.ts');
    const listed = /const DIRECT_EXCLUDED = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    expect(listed.split(',').map((item) => item.trim().replace(/'/g, '')).filter(Boolean))
      .toEqual([...DIRECT_EXCLUDED_PREFIXES]);
  });
});
