import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { OAuthCapture } from '../src/app/oauth-capture.ts';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('returns full callback URL on first request, serves Done page to browser, closes listener', async () => {
  const port = await freePort();
  const capture = new OAuthCapture(() => undefined);
  const result = capture.capture(port, 10_000);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const response = await fetch(`http://127.0.0.1:${port}/auth/callback?code=fake-code&state=fake-state`);
  const page = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(page, /回到 Plasticine/);
  assert.match(page, /prefers-color-scheme: dark/);
  assert.equal(await result, `http://localhost:${port}/auth/callback?code=fake-code&state=fake-state`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await assert.rejects(fetch(`http://127.0.0.1:${port}/again`));
});

test('returns null on timeout and closes listener', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const port = await freePort();
  const capture = new OAuthCapture(() => undefined);
  const result = capture.capture(port, 5_000);
  t.mock.timers.tick(5_000);
  assert.equal(await result, null);
});

test('returns null on cancel and closes prior listener when a new one starts', async () => {
  const port = await freePort();
  const capture = new OAuthCapture(() => undefined);
  const first = capture.capture(port, 60_000);
  capture.cancel();
  assert.equal(await first, null);
  const second = capture.capture(port, 60_000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const third = capture.capture(port, 60_000);
  assert.equal(await second, null);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await fetch(`http://127.0.0.1:${port}/cb?code=fake`);
  assert.equal(await third, `http://localhost:${port}/cb?code=fake`);
});

test('returns null and logs a line when port is already in use', async (t) => {
  const busy = createServer((_req, res) => res.end('别人的'));
  await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
  t.after(() => busy.close());
  const port = (busy.address() as AddressInfo).port;
  const logs: string[] = [];
  const capture = new OAuthCapture((line) => logs.push(line));
  assert.equal(await capture.capture(port, 10_000), null);
  assert.equal(logs.length, 1);
  assert.match(logs[0] ?? '', new RegExp(`${port}.*占`));
});
