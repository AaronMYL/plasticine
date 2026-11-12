// 直连通道这一头（11-12《首次使用解耦》）：通道里的请求带着握手那次的会话转给本体，鉴权、接口和普通请求同一套；
// 回应切块发回；登录、账号类接口不转；转进去的请求在「登录着的设备」里标直连；werift 两头真连一次。

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { afterEach, test } from 'node:test';
import { DIRECT_CHANNEL_LABEL, decodeChunk, encodeChunk, type DirectFrame } from '../../shared/api/direct.ts';
import { DirectChannelServer, type DirectPipe, type DirectTarget } from '../../src/direct/channel.ts';
import { call, json, pair, startTestApp, type TestApp } from '../app/helpers.ts';

const open: TestApp[] = [];
afterEach(async () => {
  for (const item of open.splice(0)) await item.close();
});

interface Collected {
  frames: DirectFrame[];
  bodies: Map<number, Uint8Array[]>;
}

function fakePipe(): { pipe: DirectPipe; seen: Collected; done: (id: number) => Promise<void> } {
  const seen: Collected = { frames: [], bodies: new Map() };
  const waiters = new Map<number, () => void>();
  const pipe: DirectPipe = {
    send: (data) => {
      if (typeof data === 'string') {
        const frame = JSON.parse(data) as DirectFrame;
        seen.frames.push(frame);
        if (frame.t === 'end' || frame.t === 'err') waiters.get(frame.id)?.();
        return;
      }
      const { id, data: piece } = decodeChunk(data);
      seen.bodies.set(id, [...seen.bodies.get(id) ?? [], new Uint8Array(piece)]);
    },
    bufferedAmount: () => 0,
    drained: async () => {},
  };
  const done = (id: number): Promise<void> => new Promise((resolve) => {
    if (seen.frames.some((frame) => frame.id === id && (frame.t === 'end' || frame.t === 'err'))) resolve();
    else waiters.set(id, resolve);
  });
  return { pipe, seen, done };
}

function bodyText(seen: Collected, id: number): string {
  return Buffer.concat((seen.bodies.get(id) ?? []).map((piece) => Buffer.from(piece))).toString('utf8');
}

async function signedIn(): Promise<{ t: TestApp; target: DirectTarget }> {
  const t = await startTestApp([]);
  open.push(t);
  const cookie = await pair(t);
  const port = Number(new URL(t.base).port);
  return { t, target: { port, cookie, host: 'alex.cyberhunter.top', marker: t.app.deps.direct.marker } };
}

test('通道里的请求照普通请求处理：带着会话、回应切块发回；设备标直连', async () => {
  const { target } = await signedIn();
  const { pipe, seen, done } = fakePipe();
  const server = new DirectChannelServer(pipe, () => target);
  server.receive(JSON.stringify({ t: 'req', id: 1, method: 'GET', path: '/v2/devices', headers: { accept:
    'application/json', 'x-plasticine-local-token': 'should-not-pass' }, body: false }));
  await done(1);
  const head = seen.frames.find((frame) => frame.id === 1 && frame.t === 'res');
  assert.equal(head?.t === 'res' ? head.status : null, 200);
  const devices = (JSON.parse(bodyText(seen, 1)) as { devices: { current: boolean; via?: string }[] }).devices;
  assert.equal(devices.find((device) => device.current)?.via, 'direct');
  server.close();
});

test('带正文的请求：正文分块进去', async () => {
  const { t, target } = await signedIn();
  const { pipe, seen, done } = fakePipe();
  const server = new DirectChannelServer(pipe, () => target);
  const cookie = target.cookie;
  const current = json(await call(t, 'GET', '/v2/translate/settings', { cookie }));
  const payload = new TextEncoder().encode(JSON.stringify(current));
  server.receive(JSON.stringify({ t: 'req', id: 7, method: 'PUT', path: '/v2/translate/settings',
    headers: { 'content-type': 'application/json' }, body: true }));
  server.receive(encodeChunk(7, payload.subarray(0, 5)));
  server.receive(encodeChunk(7, payload.subarray(5)));
  server.receive(JSON.stringify({ t: 'end', id: 7 }));
  await done(7);
  const head = seen.frames.find((frame) => frame.id === 7 && frame.t === 'res');
  assert.equal(head?.t === 'res' ? head.status : null, 200, bodyText(seen, 7));
  server.close();
});

test('登录、账号、握手类接口不转；没有端口时也不转', async () => {
  const { target } = await signedIn();
  const { pipe, seen, done } = fakePipe();
  const server = new DirectChannelServer(pipe, () => target);
  server.receive(JSON.stringify({ t: 'req', id: 2, method: 'GET', path: '/v2/account/own-url', headers: {},
    body: false }));
  server.receive(JSON.stringify({ t: 'req', id: 3, method: 'DELETE', path: '/v2/session', headers: {}, body: false }));
  await done(2);
  await done(3);
  assert.deepEqual(seen.frames, [{ t: 'err', id: 2 }, { t: 'err', id: 3 }]);
  const idle = fakePipe();
  new DirectChannelServer(idle.pipe, () => null).receive(JSON.stringify({ t: 'req', id: 4, method: 'GET',
    path: '/v2/devices', headers: {}, body: false }));
  await idle.done(4);
  assert.deepEqual(idle.seen.frames, [{ t: 'err', id: 4 }]);
  server.close();
});

test('握手要登录；werift 两头真连一次，通道里拿到设备列表', async () => {
  const t = await startTestApp([]);
  open.push(t);
  const cookie = await pair(t);
  assert.equal((await call(t, 'POST', '/v2/direct/offer', { body: { sdp: 'v=0' } })).status, 401);
  const require = createRequire(import.meta.url);
  const { RTCPeerConnection } = require('werift') as { RTCPeerConnection: new (config: object) => any };
  const peer = new RTCPeerConnection({ iceServers: [], iceUseDefaultStunServer: false });
  const channel = peer.createDataChannel(DIRECT_CHANNEL_LABEL, { ordered: true });
  await peer.setLocalDescription(await peer.createOffer());
  await new Promise<void>((resolve) => {
    if (peer.iceGatheringState === 'complete') resolve();
    else peer.iceGatheringStateChange.subscribe((state: string) => state === 'complete' && resolve());
  });
  const reply = await call(t, 'POST', '/v2/direct/offer', { cookie, body: { sdp: peer.localDescription.sdp } });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  await peer.setRemoteDescription({ type: 'answer', sdp: String(json(reply)['sdp']) });
  const text = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('直连 20 秒没通')), 20_000);
    const pieces: Buffer[] = [];
    channel.onMessage.subscribe((data: string | Buffer) => {
      if (typeof data !== 'string') {
        pieces.push(Buffer.from(decodeChunk(new Uint8Array(data)).data));
        return;
      }
      const frame = JSON.parse(data) as DirectFrame;
      if (frame.t === 'end') {
        clearTimeout(timer);
        resolve(Buffer.concat(pieces).toString('utf8'));
      }
    });
    channel.stateChanged.subscribe((state: string) => {
      if (state === 'open') {
        channel.send(JSON.stringify({ t: 'req', id: 1, method: 'GET', path: '/v2/devices', headers: {}, body: false }));
      }
    });
  });
  assert.match(text, /"via":"direct"/);
  await peer.close();
});
