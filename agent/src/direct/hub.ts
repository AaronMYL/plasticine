import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { DIRECT_CHANNEL_LABEL, DIRECT_STUN_URLS } from '../../shared/api/direct.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { DirectChannelServer, type DirectPipe, type DirectTarget } from './channel.ts';

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
  return new werift.RTCPeerConnection({ iceServers, iceUseDefaultStunServer: false, iceStunGatherTimeout: 2 });
}

const GATHER_TIMEOUT_MS = 3000;
const MAX_PEERS = 16;
const OPEN_TIMEOUT_MS = 30_000;

export interface DirectSession {
  sessionId: string;
  cookie: string;
  host: string;
}

interface Entry {
  peer: WeriftPeer;
  server: DirectChannelServer | null;
  opened: boolean;
}

export interface DirectHubOptions {
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
  readonly marker = randomBytes(24).toString('base64url');
  readonly #options: DirectHubOptions;
  readonly #peers = new Map<string, Entry>();

  constructor(options: DirectHubOptions) {
    this.#options = options;
  }

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
