import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withClientFiles } from '../../src/app/static-client.ts';

interface Served {
  url: string;
  apiCalls: string[];
  close(): Promise<void>;
}

async function serve(t: { after(fn: () => void | Promise<void>): void }, directory: string): Promise<Served> {
  const apiCalls: string[] = [];
  const api = (req: IncomingMessage, res: ServerResponse): void => {
    apiCalls.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"api":true}');
  };
  const server = createServer(withClientFiles(directory, api));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const close = (): Promise<void> => new Promise((resolve) => server.close(() => resolve()));
  t.after(close);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiCalls, close };
}

function clientBuild(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-static-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Plasticine</title>');
  writeFileSync(join(directory, 'assets', 'app-1a2b.js'), 'console.log("中文");');
  writeFileSync(join(directory, 'client-manifest.json'), '{"buildId":"x"}');
  return directory;
}

test('/v2/ 的请求原样交给接口，不碰静态文件', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/v2/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { api: true });
  assert.deepEqual(served.apiCalls, ['/v2/health']);
});

test('根路径给 index.html，入口页每次都要问一下（no-cache）', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  assert.match(await response.text(), /<title>Plasticine<\/title>/);
  assert.deepEqual(served.apiCalls, []);
});

test('带哈希的构建产物长缓存，类型按扩展名', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/assets/app-1a2b.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/javascript/);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await response.text(), 'console.log("中文");');
});

test('没有的页面路径回到 index.html（hash 路由之外的深链也能打开）', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/today/anything`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Plasticine/);
});

test('没有的构建产物回 404，不拿 index.html 冒充脚本', async (t) => {
  const served = await serve(t, clientBuild(t));
  const response = await fetch(`${served.url}/assets/missing.js`);
  assert.equal(response.status, 404);
});

test('跳出构建目录的路径一律拒绝', async (t) => {
  const directory = clientBuild(t);
  writeFileSync(join(directory, '..', 'plasticine-static-secret.txt'), 'secret');
  t.after(() => rmSync(join(directory, '..', 'plasticine-static-secret.txt'), { force: true }));
  const served = await serve(t, directory);
  for (const path of ['/..%2fplasticine-static-secret.txt', '/assets/..%2f..%2fplasticine-static-secret.txt',
    '/%00index.html']) {
    const response = await fetch(`${served.url}${path}`);
    assert.notEqual(await response.text(), 'secret', path);
    assert.ok([400, 404].includes(response.status), `${path} → ${response.status}`);
  }
});

test('只接 GET / HEAD，别的方法回 405', async (t) => {
  const served = await serve(t, clientBuild(t));
  const head = await fetch(`${served.url}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(`${served.url}/`, { method: 'POST', body: '{}' });
  assert.equal(post.status, 405);
});
