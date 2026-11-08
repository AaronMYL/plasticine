// Plasticine 的 service worker：只做「立刻打断」档的系统通知（第 91 条 ⑤）。
// - push：只显示服务端给的 title / body（agent/shared/api/push.ts 的 PushPayload：一句话加一个站内链接），不带卡上的
//   内容；同一张卡的新通知按 tag 换掉旧的。格式不对就显示一句固定的话，不把收到的东西原样贴出来。
// - notificationclick：关掉通知，回到已经开着的 Plasticine 并跳到 url；没有开着的就新开一个。只跳本站的路径。
// - 离线兜底（用户视角审查 2026-11-01 第 16 条 ③）：install 时只预缓存本站的 offline.html；fetch 只拦导航请求
//   （mode === 'navigate'），网络失败时回 offline.html。接口、/sw.js、资源一律不拦、不缓存（第 92 条：/sw.js 不缓存，
//   更新机制不变）。

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
  event.waitUntil(cacheOfflinePage());
});

async function dropOldOfflineCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith('plasticine-offline-') && name !== OFFLINE_CACHE)
    .map((name) => caches.delete(name)));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(dropOldOfflineCaches());
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

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') {
    return;
  }
  event.respondWith(navigateOrOffline(event.request));
});
