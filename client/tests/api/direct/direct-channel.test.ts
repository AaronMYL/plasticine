// 页面这一头的直连（11-12《首次使用解耦》）：offer 交给本体换 answer、通道开了才发；请求帧、正文块、回应原样往返；
// worker 递来的请求先回「收到」，通道没开回 fallback；通道断了在途的都报错，隔一阵再连。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeChunk, encodeChunk, type DirectFrame } from '../../../src/api/shared.ts';
import { DirectChannel } from '../../../src/api/direct/direct-channel.ts';
import { serveDirect } from '../../../src/api/direct/sw-bridge.ts';

afterEach(() => vi.useRealTimers());

/** 假的数据通道：页面发出的帧记下来；本体那头的回话用 reply 送进来。 */
class FakeChannel {
  readyState: RTCDataChannelState = 'connecting';
  binaryType = 'blob';
  sent: (string | Uint8Array)[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  send(data: string | Uint8Array): void { this.sent.push(data); }
  close(): void {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.onclose?.();
  }
  openNow(): void { this.readyState = 'open'; this.onopen?.(); }
  reply(data: string | Uint8Array): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : data.slice().buffer });
  }
}

function fakePeer(channel: FakeChannel) {
  return {
    iceGatheringState: 'complete',
    connectionState: 'new',
    localDescription: { sdp: 'v=0 offer', type: 'offer' },
    createDataChannel: () => channel,
    createOffer: async () => ({ sdp: 'v=0 offer', type: 'offer' }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: vi.fn(async () => { setTimeout(() => channel.openNow(), 0); }),
    addEventListener: () => undefined,
    close: vi.fn(),
  } as unknown as RTCPeerConnection;
}

async function connected(): Promise<{ direct: DirectChannel; channel: FakeChannel; offer: ReturnType<typeof vi.fn> }> {
  const channel = new FakeChannel();
  const offer = vi.fn(async () => 'v=0 answer');
  const direct = new DirectChannel({ offer, createPeer: () => fakePeer(channel) });
  const open = new Promise<void>((resolve) => direct.onChange((value) => value && resolve()));
  direct.start();
  await open;
  return { direct, channel, offer };
}

describe('直连通道 · 页面这一头', () => {
  it('交 offer 换 answer，开了以后发请求帧和正文块，回应头、正文、结束原样回来', async () => {
    const { direct, channel, offer } = await connected();
    expect(offer).toHaveBeenCalledWith('v=0 offer');
    expect(channel.binaryType).toBe('arraybuffer');
    const seen: string[] = [];
    const body = new TextEncoder().encode('{"a":1}');
    const result = direct.send({ method: 'POST', path: '/v2/notes', headers: { 'content-type': 'application/json' },
      body: body.buffer }, {
      head: (reply) => seen.push(`head ${reply.status}`),
      chunk: (data) => seen.push(`chunk ${new TextDecoder().decode(data)}`),
      end: () => seen.push('end'),
      error: () => seen.push('error'),
    });
    expect(result.sent).toBe(true);
    const frame = JSON.parse(channel.sent[0] as string) as DirectFrame;
    expect(frame).toMatchObject({ t: 'req', method: 'POST', path: '/v2/notes', body: true });
    expect(new TextDecoder().decode(decodeChunk(channel.sent[1] as Uint8Array).data)).toBe('{"a":1}');
    expect(JSON.parse(channel.sent[2] as string)).toEqual({ t: 'end', id: frame.id });
    channel.reply(JSON.stringify({ t: 'res', id: frame.id, status: 201, headers: {} }));
    channel.reply(encodeChunk(frame.id, new TextEncoder().encode('ok')));
    channel.reply(JSON.stringify({ t: 'end', id: frame.id }));
    expect(seen).toEqual(['head 201', 'chunk ok', 'end']);
    direct.stop();
  });

  it('登录类接口不从通道发；通道断了在途的报错、隔一阵再连', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { direct, channel } = await connected();
    const sink = { head: vi.fn(), chunk: vi.fn(), end: vi.fn(), error: vi.fn() };
    expect(direct.send({ method: 'POST', path: '/v2/session/password', headers: {}, body: null }, sink).sent)
      .toBe(false);
    expect(direct.send({ method: 'GET', path: '/v2/lines', headers: {}, body: null }, sink).sent).toBe(true);
    const closed = new Promise<void>((resolve) => direct.onChange((value) => !value && resolve()));
    channel.close();
    await closed;
    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(direct.open).toBe(false);
    expect(direct.send({ method: 'GET', path: '/v2/lines', headers: {}, body: null }, sink).sent).toBe(false);
    direct.stop();
  });

  it('worker 递来的请求：先回收到；通道没开回 fallback', () => {
    const direct = new DirectChannel({ offer: vi.fn(), createPeer: vi.fn() });
    const posted: unknown[] = [];
    const port = { postMessage: (message: unknown) => posted.push(message), close: vi.fn(), onmessage: null };
    serveDirect(direct, { type: 'plasticine-direct-fetch', method: 'GET', path: '/v2/lines', headers: {}, body: null },
      port as unknown as MessagePort);
    expect(posted).toEqual([{ type: 'ack' }, { type: 'fallback', sent: false }]);
  });
});
