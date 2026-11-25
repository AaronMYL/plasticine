import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchForServer } from '../src/feeds/fetch-for-server.ts';

const JOB = { id: 'ff-12345678-aaaa', url: 'https://blog.example.test/feed' };

test('returns redirected URL and body without sending login cookies', async () => {
  const seen: RequestInit[] = [];
  const result = await fetchForServer(async (_url, init) => {
    seen.push(init ?? {});
    return Object.defineProperty(new Response('<rss></rss>'), 'url', { value: 'https://blog.example.test/feed/' });
  }, JOB);
  assert.deepEqual(result, { page: { url: 'https://blog.example.test/feed/', text: '<rss></rss>' }, error: null });
  assert.equal(seen[0]?.credentials, 'omit');
  assert.equal(seen[0]?.redirect, 'follow');
});

test('sends Plasticine browser login cookies for Reddit only and omits them for other sites', async () => {
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

test('refuses localhost, private network, and http URLs on behalf of server', async () => {
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

test('reports reason on upstream error, body over 2 MB, or load failure', async () => {
  assert.deepEqual(await fetchForServer(async () => new Response('', { status: 429 }), JOB),
    { page: null, error: { code: 'http_error', status: 429 } });
  assert.deepEqual(await fetchForServer(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)), JOB),
    { page: null, error: { code: 'too_large' } });
  assert.deepEqual(await fetchForServer(async () => {
    throw new TypeError('net::ERR_CONNECTION_RESET');
  }, JOB), { page: null, error: { code: 'load_failed', detail: 'net::ERR_CONNECTION_RESET' } });
  assert.deepEqual(await fetchForServer(async () => Object.defineProperty(new Response('x'), 'url',
    { value: 'https://10.0.0.1/feed' }), JOB), { page: null, error: { code: 'refused' } });
});
