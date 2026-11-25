/**
 * Plasticine service worker handling push notifications, offline navigation fallback, and WebRTC direct-channel
 * proxying for `/v2/` requests.
 */

const FALLBACK_TITLE = 'Plasticine';
const FALLBACK_BODY = '有一件事要你马上看。';
const FALLBACK_URL = '/';

function isText(value) {
  return typeof value === 'string' && value.length > 0;
}

/** Resolves `value` against `self.location.origin` and rejects cross-origin targets such as `/\evil.example/`. */
function safePath(value) {
  if (!isText(value) || !value.startsWith('/')) {
    return FALLBACK_URL;
  }
  let parsed;
  try {
    parsed = new URL(value, self.location.origin);
  } catch (error) {
    console.warn('Invalid notification target URL; falling back to /', error);
    return FALLBACK_URL;
  }
  if (parsed.origin !== self.location.origin) {
    return FALLBACK_URL;
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function readPayload(event) {
  if (event.data === null || event.data === undefined) {
    return null;
  }
  try {
    return event.data.json();
  } catch (error) {
    console.warn('Non-JSON push payload received; using fallback notification', error);
    return null;
  }
}

/** Validates incoming push payloads against the shared `PushPayload` schema. */
// BEGIN generated PushPayloadSchema
const isPushPayload = (() => {

// @ts-ignore
let External = []

// @ts-ignore
function SetExternal(external) { External = external.variables }

// @ts-ignore
const check_0 = ((value) => ((typeof value === "object" &&
    value !== null &&
    !(Array.isArray(value))) &&
    (((("title" in value &&
    "body" in value) &&
    "url" in value) &&
    "tag" in value) &&
    (((typeof value.title === "string" &&
    typeof value.body === "string") &&
    (typeof value.url === "string" &&
    External[0].test(value.url))) &&
    typeof value.tag === "string"))));

// @ts-ignore
function Check(value) { return check_0(value) }
SetExternal({ variables: [/^\//u] });
return Check;
})();
// END generated PushPayloadSchema

function notificationOf(payload) {
  if (!isPushPayload(payload)) {
    return { title: FALLBACK_TITLE, options: { body: FALLBACK_BODY, tag: undefined, data: { url: FALLBACK_URL } } };
  }
  return {
    title: payload.title,
    options: {
      body: payload.body,
      tag: payload.tag === '' ? undefined : payload.tag,
      data: { url: safePath(payload.url) },
    },
  };
}

async function show(title, options) {
  const existing = options.tag === undefined ? [] : await self.registration.getNotifications({ tag: options.tag });
  await self.registration.showNotification(title, existing.length > 0 ? { ...options, silent: true } : options);
}

self.addEventListener('push', (event) => {
  const { title, options } = notificationOf(readPayload(event));
  event.waitUntil(show(title, options));
});

async function openPath(path) {
  const target = new URL(path, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin) {
      await client.focus();
      if ('navigate' in client) {
        await client.navigate(target);
      }
      return;
    }
  }
  await self.clients.openWindow(target);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const path = safePath(data !== null && typeof data === 'object' ? data.url : null);
  event.waitUntil(openPath(path));
});

const OFFLINE_CACHE = 'plasticine-offline-v1';
const OFFLINE_PATH = '/offline.html';

async function cacheOfflinePage() {
  try {
    const response = await fetch(OFFLINE_PATH);
    if (!response.ok) {
      console.warn('Offline fallback page returned non-OK status', response.status);
      return;
    }
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(OFFLINE_PATH, response.clone());
  } catch (error) {
    console.warn('Failed to precache offline fallback page', error);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheOfflinePage().then(() => self.skipWaiting()));
});

async function dropOldOfflineCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith('plasticine-offline-') && name !== OFFLINE_CACHE)
    .map((name) => caches.delete(name)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(dropOldOfflineCaches().then(() => self.clients.claim()));
});

async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(OFFLINE_PATH);
    if (cached !== undefined) {
      return cached;
    }
    console.warn('Offline navigation with no cached offline page', error);
    return new Response('你离线了 · 连上网后再试。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

const DIRECT_EXCLUDED = ['/v2/direct', '/v2/session', '/v2/account', '/v2/auth'];
const DIRECT_ACK_MS = 400;
const DIRECT_HEAD_MS = 8000;
const directDeaf = new Set();

function directPath(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/v2/')) {
    return false;
  }
  return !DIRECT_EXCLUDED.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

function directMethodOk(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return true;
  }
  const type = request.headers.get('content-type') ?? '';
  return type === '' || type.startsWith('application/json');
}

function directWanted(event) {
  const request = event.request;
  if (request.mode === 'navigate' || !isText(event.clientId) || directDeaf.has(event.clientId)) {
    return false;
  }
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  return directPath(url) && directMethodOk(request);
}

function headersOf(request) {
  const headers = {};
  request.headers.forEach((value, name) => { headers[name] = value; });
  return headers;
}

/**
 * Forwards `/v2/` requests through the owning client's direct WebRTC channel. Safe reads fall back to HTTP on timeout
 * or error; dispatched writes return `Response.error()` on failure to avoid duplicate side effects.
 */
async function directFetch(event) {
  const request = event.request;
  const safe = request.method === 'GET' || request.method === 'HEAD';
  const client = await self.clients.get(event.clientId);
  if (client === undefined || client === null) {
    return null;
  }
  const body = safe ? null : await request.clone().arrayBuffer();
  const url = new URL(request.url);
  const channel = new MessageChannel();
  const port = channel.port1;
  let controller = null;
  let settled = false;
  let headTimer = 0;
  return await new Promise((resolve) => {
    const settle = (value) => {
      if (!settled) {
        settled = true;
        clearTimeout(ackTimer);
        clearTimeout(headTimer);
        resolve(value);
      }
    };
    const ackTimer = setTimeout(() => {
      directDeaf.add(event.clientId);
      port.close();
      settle(null);
    }, DIRECT_ACK_MS);
    port.onmessage = (message) => {
      const data = message.data ?? {};
      if (data.type === 'ack') {
        clearTimeout(ackTimer);
        if (safe) {
          headTimer = setTimeout(() => {
            port.postMessage({ type: 'abort' });
            port.close();
            settle(null);
          }, DIRECT_HEAD_MS);
        }
      } else if (data.type === 'fallback') {
        port.close();
        settle(safe || data.sent !== true ? null : Response.error());
      } else if (data.type === 'head') {
        const stream = new ReadableStream({
          start(next) { controller = next; },
          cancel() {
            port.postMessage({ type: 'abort' });
            port.close();
          },
        });
        const nullBody = request.method === 'HEAD' || [204, 205, 304].includes(data.status);
        settle(new Response(nullBody ? null : stream, { status: data.status, headers: data.headers }));
      } else if (data.type === 'chunk' && controller !== null) {
        controller.enqueue(new Uint8Array(data.data));
      } else if (data.type === 'end' && controller !== null) {
        controller.close();
        port.close();
      } else if (data.type === 'error') {
        if (controller !== null) {
          controller.error(new TypeError('Direct channel disconnected'));
        }
        port.close();
        settle(safe ? null : Response.error());
      }
    };
    client.postMessage({ type: 'plasticine-direct-fetch', method: request.method,
      path: `${url.pathname}${url.search}`, headers: headersOf(request), body }, [channel.port2]);
  });
}

async function directOrNetwork(event) {
  const copy = event.request.clone();
  try {
    const response = await directFetch(event);
    if (response !== null) {
      return response;
    }
  } catch (error) {
    console.warn('Direct channel fetch failed; falling back to network', error);
  }
  return await fetch(copy);
}

self.addEventListener('fetch', (event) => {
  if (directWanted(event)) {
    event.respondWith(directOrNetwork(event));
    return;
  }
  if (event.request.mode !== 'navigate') {
    return;
  }
  event.respondWith(navigateOrOffline(event.request));
});
