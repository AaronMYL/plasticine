// 第13批（11-14 Aaron：「优先服务器抓，抓不到再改由在线的电脑重试」）：电脑替服务器取一个网址——只取 https 的公网地址
// （不替它碰本机、内网），跟着跳转，只给 Reddit 带登录信息（11-14）；取到回跳转后的地址和正文，超过 2 MB、对方回错、
// 载不出都回原因。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchForServer } from '../src/feeds/fetch-for-server.ts';

const JOB = { id: 'ff-12345678-aaaa', url: 'https://blog.example.test/feed' };

test('取到：回跳转后的地址和正文；不带登录信息', async () => {
  const seen: RequestInit[] = [];
  const result = await fetchForServer(async (_url, init) => {
    seen.push(init ?? {});
    return Object.defineProperty(new Response('<rss></rss>'), 'url', { value: 'https://blog.example.test/feed/' });
  }, JOB);
  assert.deepEqual(result, { page: { url: 'https://blog.example.test/feed/', text: '<rss></rss>' }, error: null });
  assert.equal(seen[0]?.credentials, 'omit');
  assert.equal(seen[0]?.redirect, 'follow');
});

test('Reddit 带上 Plasticine 浏览器里的登录去取（11-14 Aaron 定：不登录服务器和电脑都被限流），别的网站不带', async () => {
  const seen: Array<[string, RequestCredentials | undefined]> = [];
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    seen.push([url, init?.credentials]);
    return Object.defineProperty(new Response('{}'), 'url', { value: url });
  };
  for (const url of ['https://www.reddit.com/r/LocalLLaMA/new.json', 'https://old.reddit.com/r/x/.rss',
    'https://reddit.com/r/x/.rss', 'https://notreddit.com/feed', 'https://reddit.com.example.test/feed']) {
    await fetchForServer(fetcher, { ...JOB, url });
  }
  assert.deepEqual(seen.map(([, credentials]) => credentials), ['include', 'include', 'include', 'omit', 'omit']);
});

test('不替服务器碰本机、内网和 http 地址', async () => {
  let asked = 0;
  const fetcher = async (): Promise<Response> => {
    asked += 1;
    return new Response('x');
  };
  for (const url of ['http://blog.example.test/feed', 'https://localhost/feed', 'https://127.0.0.1/feed',
    'https://10.0.0.8/feed', 'https://192.168.1.2/feed', 'https://[::1]/feed', 'https://printer.local/feed']) {
    assert.deepEqual(await fetchForServer(fetcher, { ...JOB, url }), { page: null, error: { code: 'refused' } }, url);
  }
  assert.equal(asked, 0);
});

test('对方回错、超过 2 MB、载不出：回原因', async () => {
  assert.deepEqual(await fetchForServer(async () => new Response('', { status: 429 }), JOB),
    { page: null, error: { code: 'http_error', status: 429 } });
  assert.deepEqual(await fetchForServer(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)), JOB),
    { page: null, error: { code: 'too_large' } });
  assert.deepEqual(await fetchForServer(async () => {
    throw new TypeError('net::ERR_CONNECTION_RESET');
  }, JOB), { page: null, error: { code: 'load_failed', detail: 'net::ERR_CONNECTION_RESET' } });
  // 跳转到了内网：不交回正文。
  assert.deepEqual(await fetchForServer(async () => Object.defineProperty(new Response('x'), 'url',
    { value: 'https://10.0.0.1/feed' }), JOB), { page: null, error: { code: 'refused' } });
});
