// Plasticine 的 service worker：只做「立刻打断」档的系统通知（第 91 条 ⑤）。
// - push：只显示服务端给的 title / body（agent/shared/api/push.ts 的 PushPayload：一句话加一个站内链接），不带卡上的
//   内容；同一张卡的新通知按 tag 换掉旧的。格式不对就显示一句固定的话，不把收到的东西原样贴出来。
// - notificationclick：关掉通知，回到已经开着的 Plasticine 并跳到 url；没有开着的就新开一个。只跳本站的路径。
// - 离线兜底（用户视角审查 2026-11-01 第 16 条 ③）：install 时只预缓存本站的 offline.html；fetch 只拦导航请求
//   （mode === 'navigate'），网络失败时回 offline.html。接口、/sw.js、资源一律不拦、不缓存（第 92 条：/sw.js 不缓存，
//   更新机制不变）。
// - 直连（11-12《首次使用解耦》）：本站 /v2/ 的请求（含图片、附件、事件流）先问发请求的那个页面能不能从直连通道发；
//   页面通道开着就由它发、把回应一块块递回来，不开就照旧走网络（经中继）。登录、账号、握手类不走；上传文件不走。
//   写操作一旦交给通道就不再改走网络（免得做两遍）；读操作通道出错改走网络。

const FALLBACK_TITLE = 'Plasticine';
const FALLBACK_BODY = '有一件事要你马上看。';
const FALLBACK_URL = '/';

function isText(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 服务端给的 url 必须是本站的路径，别的一律回首页。光看前缀不够：`/\evil.example/` 里的反斜杠、夹在中间的制表符和
 * 换行，URL 解析时会被规范化成 `//evil.example/`（审查 88c54ec P2），所以按本站解析之后再核对 origin。
 */
function safePath(value) {
  if (!isText(value) || !value.startsWith('/')) {
    return FALLBACK_URL;
  }
  let parsed;
  try {
    parsed = new URL(value, self.location.origin);
  } catch (error) {
    console.warn('通知里的链接解析不了，回首页', error);
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
    console.warn('收到一条不是 JSON 的推送，显示固定的一句', error);
    return null;
  }
}

/**
 * 整体对照共享的推送协议（agent/shared/api/push.ts 的 PushPayload：title、body、url、tag 四个字符串，url 以 / 开头）。
 * 少一个字段、类型不对，就整条都不信，统一用固定的话——不拿半截载荷里的正文去显示（审查 cb3a98d P2）。
 */
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

self.addEventListener('push', (event) => {
  const { title, options } = notificationOf(readPayload(event));
  event.waitUntil(self.registration.showNotification(title, options));
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

// ---------- 离线兜底 ----------

// 缓存名带版本：改了 offline.html 就换名字，activate 时把旧的删掉。
const OFFLINE_CACHE = 'plasticine-offline-v1';
const OFFLINE_PATH = '/offline.html';

async function cacheOfflinePage() {
  try {
    const response = await fetch(OFFLINE_PATH);
    if (!response.ok) {
      console.warn('离线页没有下到，先不缓存', response.status);
      return;
    }
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(OFFLINE_PATH, response.clone());
  } catch (error) {
    console.warn('离线页没有下到，先不缓存', error);
  }
}

self.addEventListener('install', (event) => {
  // 新版 worker 不等旧页面全关掉：直连这一段要马上接管。
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

/** 导航请求先走网络；网络失败才回缓存里的离线页；连离线页都没有就回一个本站的 503，不让导航悬着。 */
async function navigateOrOffline(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(OFFLINE_PATH);
    if (cached !== undefined) {
      return cached;
    }
    console.warn('离线且没有缓存的离线页', error);
    return new Response('你离线了 · 连上网后再试。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}

// ---------- 直连 ----------

// 和 agent/shared/api/direct.ts 的 DIRECT_EXCLUDED_PREFIXES 一致（测试核对）。
const DIRECT_EXCLUDED = ['/v2/direct', '/v2/session', '/v2/account', '/v2/auth'];
/** 页面多久没回「收到」就当它不管直连（旧页面没装这一段）。 */
const DIRECT_ACK_MS = 400;
/** 读请求多久没等到回应头就改走网络。 */
const DIRECT_HEAD_MS = 8000;
/** 没回过「收到」的页面：这个 worker 活着时不再问它。 */
const directDeaf = new Set();

function directPath(url) {
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/v2/')) {
    return false;
  }
  return !DIRECT_EXCLUDED.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
}

/** 只转读请求和 JSON 写请求；上传（文件、表单）照旧走网络，进度条才准。 */
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
 * 交给页面发：先等一声「收到」，再等回应头，然后正文一块块进一个流。拿不到就回 null（改走网络）；
 * 写请求交出去以后出错回 Response.error()，不再走网络。
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
          cancel() { port.postMessage({ type: 'abort' }); port.close(); },
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
          controller.error(new TypeError('直连断了'));
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
    console.warn('直连这次没用上，改走网络', error);
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
