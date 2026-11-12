// 直连的握手和通道管理（11-12《首次使用解耦》）：页面交来 offer，本体用 werift（纯 TypeScript 的 WebRTC，服务包不带原生
// 模块）答一个 answer，候选收齐了一起给（不逐条送）；页面开的数据通道交给 channel.ts。
// 一次登录会话只留一条：同一会话再握手，旧的关掉。总数有上限，超了先关最早的。打洞成败不报给中继。

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { DIRECT_CHANNEL_LABEL, DIRECT_STUN_URLS } from '../../shared/api/direct.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { DirectChannelServer, type DirectPipe, type DirectTarget } from './channel.ts';

/** werift 里用到的那几样（测试里换成假的也行）。 */
interface WeriftChannel {
  label: string;
  readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string | Buffer): void;
  close(): void;
  onMessage: { subscribe(listener: (data: string | Buffer) => void): unknown };
  stateChanged: { subscribe(listener: (state: string) => void): unknown };
  bufferedAmountLow: { subscribe(listener: () => void): unknown };
}

interface WeriftPeer {
  iceGatheringState: string;
  connectionState: string;
  localDescription?: { sdp: string; type: string } | null;
  setRemoteDescription(description: { sdp: string; type: 'offer' }): Promise<unknown>;
  createAnswer(): Promise<{ sdp: string; type: string }>;
  setLocalDescription(description: { sdp: string; type: string }): Promise<unknown>;
  close(): Promise<void> | void;
  onDataChannel: { subscribe(listener: (channel: WeriftChannel) => void): unknown };
  iceGatheringStateChange: { subscribe(listener: (state: string) => void): unknown };
  connectionStateChange: { subscribe(listener: (state: string) => void): unknown };
}

type PeerFactory = (iceServers: { urls: string }[]) => WeriftPeer;

const require = createRequire(import.meta.url);

function weriftPeer(iceServers: { urls: string }[]): WeriftPeer {
  const werift = require('werift') as { RTCPeerConnection: new (config: object) => WeriftPeer };
  // 不用 werift 自带的谷歌 STUN；一家 STUN 两秒不答就不等它。
  return new werift.RTCPeerConnection({ iceServers, iceUseDefaultStunServer: false, iceStunGatherTimeout: 2 });
}

/** 收候选最多等这么久，到点有多少给多少。 */
const GATHER_TIMEOUT_MS = 3000;
/** 同时最多这么多条直连。 */
const MAX_PEERS = 16;
/** 一条通道这么久没开起来就关掉。 */
const OPEN_TIMEOUT_MS = 30_000;

export interface DirectSession {
  /** 登录会话的 id：一个会话只留一条通道。 */
  sessionId: string;
  /** 握手那次请求带的会话 cookie（只在本进程内存里，转请求时带上）。 */
  cookie: string;
  /** 页面打开的主机名（转请求时当 Host 带上）。 */
  host: string;
}

interface Entry {
  peer: WeriftPeer;
  server: DirectChannelServer | null;
  opened: boolean;
}

export interface DirectHubOptions {
  /** 本体在本机听的端口；还没开始听是 null。 */
  port: () => number | null;
  iceServers?: { urls: string }[];
  createPeer?: PeerFactory;
}

function waitGathered(peer: WeriftPeer): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    peer.iceGatheringStateChange.subscribe((state) => {
      if (state === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

function pipeOf(channel: WeriftChannel): DirectPipe {
  channel.bufferedAmountLowThreshold = 256 * 1024;
  let waiting: (() => void)[] = [];
  channel.bufferedAmountLow.subscribe(() => {
    const done = waiting;
    waiting = [];
    for (const resolve of done) resolve();
  });
  return {
    send: (data) => {
      channel.send(typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    },
    bufferedAmount: () => channel.bufferedAmount,
    drained: () => new Promise((resolve) => {
      if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
        resolve();
        return;
      }
      waiting.push(resolve);
    }),
  };
}

export class DirectHub {
  /** 本进程的记号：转给本体的请求带着它，「登录着的设备」据此标直连。 */
  readonly marker = randomBytes(24).toString('base64url');
  readonly #options: DirectHubOptions;
  readonly #peers = new Map<string, Entry>();

  constructor(options: DirectHubOptions) {
    this.#options = options;
  }

  /** 页面交来 offer：答一个 answer（候选都在里面）。 */
  async answer(offerSdp: string, session: DirectSession): Promise<string> {
    this.#drop(session.sessionId);
    while (this.#peers.size >= MAX_PEERS) {
      const oldest = this.#peers.keys().next().value;
      if (oldest === undefined) break;
      this.#drop(oldest);
    }
    const create = this.#options.createPeer ?? weriftPeer;
    const peer = create(this.#options.iceServers ?? DIRECT_STUN_URLS.map((urls) => ({ urls })));
    const entry: Entry = { peer, server: null, opened: false };
    this.#peers.set(session.sessionId, entry);
    const target = (): DirectTarget | null => {
      const port = this.#options.port();
      return port === null ? null : { port, cookie: session.cookie, host: session.host, marker: this.marker };
    };
    peer.onDataChannel.subscribe((channel) => {
      if (channel.label !== DIRECT_CHANNEL_LABEL || entry.server !== null) {
        channel.close();
        return;
      }
      const server = new DirectChannelServer(pipeOf(channel), target);
      entry.server = server;
      entry.opened = true;
      channel.onMessage.subscribe((data) => {
        server.receive(typeof data === 'string' ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      });
      channel.stateChanged.subscribe((state) => {
        if (state === 'closed') this.#forget(session.sessionId, entry);
      });
    });
    peer.connectionStateChange.subscribe((state) => {
      if (state === 'failed' || state === 'closed') this.#forget(session.sessionId, entry);
    });
    setTimeout(() => {
      if (!entry.opened) this.#forget(session.sessionId, entry);
    }, OPEN_TIMEOUT_MS).unref();
    try {
      await peer.setRemoteDescription({ type: 'offer', sdp: offerSdp });
      await peer.setLocalDescription(await peer.createAnswer());
      await waitGathered(peer);
      const local = peer.localDescription;
      if (local === undefined || local === null) throw new Error('没生成 answer');
      return local.sdp;
    } catch (error) {
      this.#forget(session.sessionId, entry);
      throw error;
    }
  }

  /** 这个会话的通道关掉（退出登录、撤销设备时）。 */
  endSession(sessionId: string): void {
    this.#drop(sessionId);
  }

  size(): number {
    return this.#peers.size;
  }

  close(): void {
    for (const sessionId of [...this.#peers.keys()]) this.#drop(sessionId);
  }

  #drop(sessionId: string): void {
    const entry = this.#peers.get(sessionId);
    if (entry !== undefined) this.#forget(sessionId, entry);
  }

  #forget(sessionId: string, entry: Entry): void {
    if (this.#peers.get(sessionId) === entry) this.#peers.delete(sessionId);
    entry.server?.close();
    try {
      void Promise.resolve(entry.peer.close()).catch((error: unknown) => {
        safeLog('warn', 'direct_close_failed', { category: errorCategory(error) });
      });
    } catch (error) {
      safeLog('warn', 'direct_close_failed', { category: errorCategory(error) });
    }
  }
}
