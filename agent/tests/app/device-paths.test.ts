// 登录着的设备怎么连进来的（11-12《首次使用解耦》）：隧道解开的连接是经中继，直连通道转进来的是直连，本机回环、
// 主机名也是本机的是本机，其余（自己的反向代理、Tailscale）算自己的网址；设备列表带上最近一次。

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

test('本机 / 经中继 / 直连 / 自己的网址', () => {
  const paths = new DevicePaths();
  assert.equal(paths.pathOf(req({ address: '127.0.0.1' })), 'local');
  assert.equal(paths.pathOf(req({ address: '127.0.0.1', host: 'plasticine.example.test',
    headers: { 'x-forwarded-for': '100.64.0.2' } })), 'web');
  assert.equal(paths.pathOf(req({ address: '127.0.0.1', host: 'box.example.test' })), 'web');
  const tunnel = { remoteAddress: undefined };
  paths.markTunnel(tunnel);
  assert.equal(paths.pathOf(req({ socket: tunnel, host: 'alex.cyberhunter.top' })), 'relay');
  const direct = req({ socket: tunnel });
  paths.markDirect(direct);
  assert.equal(paths.pathOf(direct), 'direct');
  paths.see('device-a', direct);
  assert.equal(paths.of('device-a'), 'direct');
  assert.equal(paths.of('device-b'), undefined);
});

const open: TestApp[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
});

test('设备列表带上这台最近一次怎么连的', async () => {
  const t = await startTestApp([]);
  open.push(t);
  const cookie = await pair(t);
  const body = json(await call(t, 'GET', '/v2/devices', { cookie })) as { devices: { current: boolean;
    via?: string }[] };
  assert.equal(body.devices.find((device) => device.current)?.via, 'local');
});
