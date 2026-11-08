import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { enterLocal, localGrantFor, parseSetCookie, probePlace, PlaceProbeError, type CookieDetails,
  type CookieJar } from '../src/app/account-client.ts';
import { LOCAL_SERVER_URL } from '../src/app/server-target.ts';

const FAKE_TOKEN = 'fake-local-token-for-tests';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function fakeServer(t: { after(fn: () => void): void }, handler: Handler): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
    });
    req.on('end', () => handler(req, res, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
}

function account(setup: 'needed' | 'done'): unknown {
  return { setup, handle: setup === 'done' ? 'sample_user' : null, displayName: null, passwordSet: setup === 'done',
    networkUrl: null };
}

class MemoryJar implements CookieJar {
  stored: CookieDetails[] = [];
  async get(): Promise<{ name: string; value: string }[]> {
    return this.stored.map((cookie) => ({ name: cookie.name, value: cookie.value }));
  }
  async set(details: CookieDetails): Promise<void> {
    this.stored.push(details);
  }
}

test('Set-Cookie 拆成 Electron 的 cookies.set 参数', () => {
  const now = Date.parse('2026-11-08T00:00:00Z');
  const cookie = parseSetCookie('plasticine_session=abc.def; Path=/; Max-Age=600; HttpOnly; SameSite=Strict',
    'http://127.0.0.1:8790/', now);
  assert.deepEqual(cookie, { url: 'http://127.0.0.1:8790/', name: 'plasticine_session', value: 'abc.def', path: '/',
    httpOnly: true, secure: false, sameSite: 'strict', expirationDate: now / 1000 + 600 });
  assert.equal(parseSetCookie('坏的', 'http://127.0.0.1:8790/', now), null);
  assert.equal(parseSetCookie('a=b; Secure; SameSite=Lax', 'http://127.0.0.1:8790/', now)?.sameSite, 'lax');
});

test('setup=done：主进程带本机令牌登录，Set-Cookie 写进界面的 session', async (t) => {
  const seen: { token: string | undefined; body: unknown }[] = [];
  const origin = await fakeServer(t, (req, res, body) => {
    if (req.url === '/v2/account/state') {
      json(res, 200, account('done'));
    } else if (req.url === '/v2/session' && req.method === 'GET') {
      json(res, 401, { error: { code: 'unauthorized' } });
    } else if (req.url === '/v2/session/local' && req.method === 'POST') {
      seen.push({ token: req.headers['x-plasticine-local-token'] as string | undefined, body: JSON.parse(body) });
      json(res, 201, { ok: true }, { 'set-cookie': 'plasticine_session=fake-session; Path=/; Max-Age=60; HttpOnly; '
        + 'SameSite=Strict' });
    } else {
      json(res, 404, {});
    }
  });
  const jar = new MemoryJar();
  const logs: string[] = [];
  const path = await enterLocal({ origin, token: FAKE_TOKEN, deviceName: '书房的电脑', fetch, jar,
    log: (line) => logs.push(line) });
  assert.equal(path, '');
  assert.deepEqual(seen, [{ token: FAKE_TOKEN, body: { deviceName: '书房的电脑' } }]);
  assert.equal(jar.stored[0]?.name, 'plasticine_session');
  assert.equal(jar.stored[0]?.value, 'fake-session');
  assert.equal(jar.stored[0]?.url, origin);
  assert.ok(logs.every((line) => !line.includes(FAKE_TOKEN) && !line.includes('fake-session')));
});

test('已经登录着（会话还有效）就不再登记一次设备', async (t) => {
  let posts = 0;
  const origin = await fakeServer(t, (req, res) => {
    if (req.url === '/v2/account/state') {
      json(res, 200, account('done'));
    } else if (req.url === '/v2/session' && req.method === 'GET') {
      json(res, req.headers.cookie === 'plasticine_session=still-good' ? 200 : 401, {});
    } else {
      posts += 1;
      json(res, 500, {});
    }
  });
  const jar = new MemoryJar();
  jar.stored.push({ url: origin, name: 'plasticine_session', value: 'still-good', path: '/', httpOnly: true,
    secure: false, sameSite: 'strict' });
  assert.equal(await enterLocal({ origin, token: FAKE_TOKEN, deviceName: 'pc', fetch, jar, log: () => undefined }),
    '');
  assert.equal(posts, 0);
});

test('setup=needed 去建账号页；本体还没有账号接口（旧版）就照旧载入，登录失败记一句不挡路', async (t) => {
  let mode: 'needed' | 'old' | 'refuse' = 'needed';
  const origin = await fakeServer(t, (req, res) => {
    if (mode === 'old') {
      json(res, 404, {});
    } else if (req.url === '/v2/account/state') {
      json(res, 200, account(mode === 'needed' ? 'needed' : 'done'));
    } else {
      json(res, 401, {});
    }
  });
  const logs: string[] = [];
  const input = { origin, token: FAKE_TOKEN, deviceName: 'pc', fetch, jar: new MemoryJar(),
    log: (line: string) => logs.push(line) };
  assert.equal(await enterLocal(input), '#/setup');
  mode = 'old';
  assert.equal(await enterLocal(input), '');
  mode = 'refuse';
  assert.equal(await enterLocal(input), '');
  assert.equal(input.jar.stored.length, 0);
  assert.match(logs.join('\n'), /本机自动登录没成/);
});

test('本机令牌只给本机同源的界面', () => {
  assert.equal(localGrantFor(`${LOCAL_SERVER_URL}#/setup`, FAKE_TOKEN), FAKE_TOKEN);
  assert.equal(localGrantFor('http://127.0.0.1:8790/settings', FAKE_TOKEN), FAKE_TOKEN);
  for (const other of ['https://sample-user.cyberhunter.top/', 'http://localhost:8790/', 'http://127.0.0.1:8791/',
    'file:///app/start.html', 'not a url']) {
    assert.equal(localGrantFor(other, FAKE_TOKEN), null, other);
  }
  assert.equal(localGrantFor(LOCAL_SERVER_URL, null), null);
});

test('连上之前先探 /v2/account/state：到得了才算；旧版本体退回看健康检查；到不了给一句原因', async (t) => {
  let mode: 'new' | 'old' | 'other' = 'new';
  const origin = await fakeServer(t, (req, res) => {
    if (mode === 'new' && req.url === '/v2/account/state') {
      json(res, 200, account('done'));
    } else if (mode === 'old' && req.url === '/v2/health') {
      json(res, 200, { ok: true });
    } else {
      json(res, 404, {});
    }
  });
  await probePlace(origin, fetch);
  mode = 'old';
  await probePlace(origin, fetch);
  mode = 'other';
  await assert.rejects(probePlace(origin, fetch), (error: unknown) => error instanceof PlaceProbeError
    && /没找到 Plasticine/.test(error.message));
  await assert.rejects(probePlace('http://127.0.0.1:9/', fetch), (error: unknown) => error instanceof PlaceProbeError
    && /连不上 127\.0\.0\.1:9/.test(error.message));
});
