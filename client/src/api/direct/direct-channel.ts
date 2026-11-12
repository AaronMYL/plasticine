// 页面这一头的直连（11-12《首次使用解耦》）：浏览器自带的 RTCPeerConnection 开一条数据通道，offer 经中继交给本体
// （POST /v2/direct/offer）换 answer；通道开着时，service worker 递来的接口请求从这里发、回应一块块递回去。
// 打不通、断了就照旧经中继；隔一阵再试（5 秒、30 秒、2 分钟、5 分钟……），切回前台也试一次。

import {
  DIRECT_CHANNEL_LABEL,
  DIRECT_CHUNK_BYTES,
  DIRECT_OFFER_PATH,
  DIRECT_STUN_URLS,
  DirectFrameSchema,
  DirectOfferResponseSchema,
  decodeChunk,
  directAllowed,
  encodeChunk,
  type DirectFrame,
} from '../shared.ts';
import { Value } from 'typebox/value';

/** 直连通了时在 window 上发的事件（事件流据此重连一次，live.tsx）。 */
export const DIRECT_OPEN_EVENT = 'plasticine:direct-open';

export interface DirectReply {
  status: number;
  headers: Record<string, string>;
}

/** 一个在途请求的去向：头、正文块、完了、出错。 */
export interface DirectSink {
  head(reply: DirectReply): void;
  chunk(data: Uint8Array): void;
  end(): void;
  error(): void;
}

export interface DirectRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
}

type Offer = (sdp: string) => Promise<string>;

const GATHER_MS = 2500;
const OPEN_MS = 10_000;
const RETRY_MS = [5_000, 30_000, 120_000, 300_000];

/** 经中继交 offer 换 answer（走普通 fetch：这一步本来就要经中继）。 */
export async function postOffer(sdp: string): Promise<string> {
  const response = await fetch(DIRECT_OFFER_PATH, { method: 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sdp }) });
  if (!response.ok) throw new Error(`直连握手 ${response.status}`);
  const body: unknown = await response.json();
  if (!Value.Check(DirectOfferResponseSchema, body)) throw new Error('直连握手的回答不对');
  return body.sdp;
}

function gathered(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, GATHER_MS);
    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

export class DirectChannel {
  readonly #offer: Offer;
  readonly #createPeer: () => RTCPeerConnection;
  #peer: RTCPeerConnection | null = null;
  #channel: RTCDataChannel | null = null;
  #nextId = 1;
  readonly #sinks = new Map<number, DirectSink>();
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #connecting = false;
  readonly #listeners = new Set<(open: boolean) => void>();

  constructor(options: { offer?: Offer; createPeer?: () => RTCPeerConnection } = {}) {
    this.#offer = options.offer ?? postOffer;
    this.#createPeer = options.createPeer
      ?? (() => new RTCPeerConnection({ iceServers: DIRECT_STUN_URLS.map((urls) => ({ urls })) }));
  }

  get open(): boolean {
    return this.#channel?.readyState === 'open';
  }

  onChange(listener: (open: boolean) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** 开始连；已经开着或正在连就不重复。 */
  start(): void {
    this.#stopped = false;
    if (this.open || this.#connecting) return;
    clearTimeout(this.#timer);
    void this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#teardown();
  }

  /** 发一个请求；通道没开回 false（调用方改走网络）。 */
  send(request: DirectRequest, sink: DirectSink): { sent: boolean; abort: () => void } {
    const channel = this.#channel;
    if (channel === null || channel.readyState !== 'open' || !directAllowed(request.path.split('?')[0] ?? '')) {
      return { sent: false, abort: () => {} };
    }
    const id = this.#nextId;
    this.#nextId = this.#nextId >= 0xfffffff0 ? 1 : this.#nextId + 1;
    this.#sinks.set(id, sink);
    const frame: DirectFrame = { t: 'req', id, method: request.method, path: request.path,
      headers: request.headers, body: request.body !== null };
    try {
      channel.send(JSON.stringify(frame));
      if (request.body !== null) {
        const bytes = new Uint8Array(request.body);
        for (let offset = 0; offset < bytes.byteLength; offset += DIRECT_CHUNK_BYTES) {
          channel.send(encodeChunk(id, bytes.subarray(offset, offset + DIRECT_CHUNK_BYTES)));
        }
        channel.send(JSON.stringify({ t: 'end', id } satisfies DirectFrame));
      }
    } catch (error) {
      console.warn('直连发请求没发出去', error);
      this.#sinks.delete(id);
      return { sent: false, abort: () => {} };
    }
    return { sent: true, abort: () => {
      if (this.#sinks.delete(id) && this.#channel?.readyState === 'open') {
        this.#channel.send(JSON.stringify({ t: 'abort', id } satisfies DirectFrame));
      }
    } };
  }

  async #connect(): Promise<void> {
    this.#connecting = true;
    this.#teardown();
    try {
      const peer = this.#createPeer();
      this.#peer = peer;
      const channel = peer.createDataChannel(DIRECT_CHANNEL_LABEL, { ordered: true });
      channel.binaryType = 'arraybuffer';
      channel.onmessage = (event: MessageEvent) => this.#receive(event.data as string | ArrayBuffer);
      channel.onclose = () => this.#lost(channel);
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.#lost(channel);
      });
      const opened = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('直连没打通')), OPEN_MS);
        channel.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      await peer.setLocalDescription(await peer.createOffer());
      await gathered(peer);
      const sdp = peer.localDescription?.sdp;
      if (sdp === undefined) throw new Error('没生成 offer');
      await peer.setRemoteDescription({ type: 'answer', sdp: await this.#offer(sdp) });
      await opened;
      if (this.#stopped) {
        this.#teardown();
        return;
      }
      this.#channel = channel;
      this.#attempt = 0;
      this.#emit(true);
    } catch (error) {
      console.info('直连这次没打通，先经中继', error);
      this.#teardown();
      this.#retry();
    } finally {
      this.#connecting = false;
    }
  }

  #receive(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      let decoded: { id: number; data: Uint8Array };
      try {
        decoded = decodeChunk(new Uint8Array(data));
      } catch {
        return;
      }
      this.#sinks.get(decoded.id)?.chunk(decoded.data);
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (!Value.Check(DirectFrameSchema, frame)) return;
    const sink = this.#sinks.get(frame.id);
    if (sink === undefined) return;
    if (frame.t === 'res') {
      sink.head({ status: frame.status, headers: frame.headers });
    } else if (frame.t === 'end') {
      this.#sinks.delete(frame.id);
      sink.end();
    } else if (frame.t === 'err') {
      this.#sinks.delete(frame.id);
      sink.error();
    }
  }

  #lost(channel: RTCDataChannel): void {
    if (this.#channel !== channel) return;
    this.#teardown();
    this.#emit(false);
    this.#retry();
  }

  #retry(): void {
    if (this.#stopped) return;
    const delay = RETRY_MS[Math.min(this.#attempt, RETRY_MS.length - 1)] ?? 300_000;
    this.#attempt += 1;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.#connect(), delay);
  }

  #teardown(): void {
    const sinks = [...this.#sinks.values()];
    this.#sinks.clear();
    for (const sink of sinks) sink.error();
    this.#channel?.close();
    this.#channel = null;
    this.#peer?.close();
    this.#peer = null;
  }

  #emit(open: boolean): void {
    for (const listener of this.#listeners) listener(open);
  }
}
