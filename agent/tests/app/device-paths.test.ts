import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { afterEach, test } from 'node:test';
import { DevicePaths } from '../../src/app/device-paths.ts';
import { call, json, pair, startTestApp, type TestApp } from './helpers.ts';

function req(input: { address?: string; host?: string; headers?: Record<string, string>; socket?: object })
  : IncomingMessage {
  const socket = input.socket ?? { remoteAddress: input.address };
  return { socket, headers: { host: input.host ?? '127.0.0.1:8790', ...input.headers } } as unknown as IncomingMessage;
}

test('connection mode detection: local, relay, direct, and custom URL', () => {
  const paths = new DevicePaths('test-marker');
  assert.equal(paths.pathOf(req({ address: '127.0.0.1' })), 'local');
  assert.equal(paths.pathOf(req({ address: '127.0.0.1', host: 'plasticine.example.test',
    headers: { 'x-forwarded-for': '100.64.0.2' } })), 'web');
  assert.equal(paths.pathOf(req({ address: '127.0.0.1', host: 'box.example.test' })), 'web');
  const tunnel = { remoteAddress: undefined };
  paths.markTunnel(tunnel);
  assert.equal(paths.pathOf(req({ socket: tunnel, host: 'alex.cyberhunter.top' })), 'relay');
  const direct = req({ address: '127.0.0.1', headers: { 'x-plasticine-direct': 'test-marker' } });
  assert.equal(paths.pathOf(direct), 'direct');
  assert.equal(paths.pathOf(req({ address: '127.0.0.1', headers: { 'x-plasticine-direct': 'guess' } })), 'local');
  paths.see('device-a', direct);
  assert.equal(paths.of('device-a'), 'direct');
  assert.equal(paths.of('device-b'), undefined);
});

const open: TestApp[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
});

test('device list includes how each device most recently connected', async () => {
  const t = await startTestApp([]);
  open.push(t);
  const cookie = await pair(t);
  const body = json(await call(t, 'GET', '/v2/devices', { cookie })) as { devices: { current: boolean;
    via?: string }[] };
  assert.equal(body.devices.find((device) => device.current)?.via, 'local');
});
