// SPDX-License-Identifier: Apache-2.0
// 隧道客户端（实例这一头，frp 模型）：一条 WSS 控制连接到中继主域名（升级请求带账号签名），中继说「open <id>」就另拨
// 一条 TLS 工作连接（ALPN WORK_ALPN）、开头说 <id> 一行，之后这条连接上来的就是外面浏览器的原始字节，交给本机的
// TLS 终结（tunnel-terminator.ts）。断了按退避重连；每 20 秒说一句，60 秒没听到中继就当断了。
// 只走 https 的中继地址：工作连接要和控制连接到同一个主域名的 443。

import { connect, type TLSSocket } from 'node:tls';
import { Value } from 'typebox/value';
import WebSocket from 'ws';
import {
  RelayControlMessageSchema,
  TUNNEL_DEAD_MS,
  TUNNEL_HEARTBEAT_MS,
  TUNNEL_PATH,
  WORK_ALPN,
  type RelayControlMessage,
} from '../shared/tunnel-wire.ts';
import { signedHeaders, type Signer } from './relay-client.ts';

const HTTPS_PORT = 443;
/** 重连退避：1 秒起，每次翻倍，最多 1 分钟。 */
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
/** 没加入网络时多久再看一次（加入时 wake 会马上叫醒）。 */
const IDLE_RECHECK_MS = 60_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;
// TCP keepalive：预开的工作连接可能闲着好几分钟，路由器的 NAT 表会忘掉不说话的连接。
const KEEPALIVE_MS = 30_000;

export interface TunnelClientOptions {
  /** 中继主域名，如 https://cyberhunter.top。 */
  relayUrl: () => string;
  /** 没加入网络时是 null：不连。 */
  signer: () => Signer | null;
  now: () => Date;
  /** 中继说了这台实例的地址（<handle>.cyberhunter.top）。 */
  onHello: (host: string) => void;
  /** 一条对接好的工作连接：之后是外面来的原始字节。 */
  onWork: (socket: TLSSocket) => void;
  /** 额外信任的证书（测试、本机演示的自签中继）。 */
  ca?: string;
  /** 把中继主机名解析成这个地址（测试、本机演示：主机名是 localtest，实际连 127.0.0.1）。 */
  relayAddress?: string;
  heartbeatMs?: number;
  deadMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
}

export type TunnelState = 'idle' | 'connecting' | 'connected' | 'waiting';

export interface TunnelStatus {
  state: TunnelState;
  host: string | null;
  lastError: string | null;
}

class TunnelRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TunnelRefused';
  }
}

export function backoffDelay(attempt: number, min: number, max: number): number {
  return Math.min(max, min * 2 ** Math.max(0, attempt));
}

function parse(data: WebSocket.RawData): unknown {
  try {
    return JSON.parse(data.toString());
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

export class TunnelClient {
  readonly #options: TunnelClientOptions;
  #status: TunnelStatus = { state: 'idle', host: null, lastError: null };
  #stopped = true;
  #loop: Promise<void> | null = null;
  #socket: WebSocket | null = null;
  #wake: (() => void) | null = null;
  readonly #work = new Set<TLSSocket>();

  constructor(options: TunnelClientOptions) {
    this.#options = options;
  }

  status(): TunnelStatus {
    return { ...this.#status };
  }

  start(): void {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    this.#loop = this.#run();
  }

  /** 加入网络了、或者想马上重连：结束当前的等待。 */
  wake(): void {
    this.#wake?.();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#socket?.terminate();
    this.wake();
    for (const work of this.#work) {
      work.destroy();
    }
    await this.#loop;
    this.#status = { ...this.#status, state: 'idle' };
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      timer.unref();
      function done(): void {
        clearTimeout(timer);
        resolve();
      }
      this.#wake = done;
    });
  }

  async #run(): Promise<void> {
    let attempt = 0;
    while (!this.#stopped) {
      const signer = this.#options.signer();
      if (signer === null) {
        this.#status = { state: 'idle', host: null, lastError: null };
        await this.#sleep(IDLE_RECHECK_MS);
        continue;
      }
      this.#status = { ...this.#status, state: 'connecting' };
      try {
        const reachedHello = await this.#session(signer);
        attempt = reachedHello ? 0 : attempt + 1;
      } catch (error) {
        this.#status = { ...this.#status, lastError: error instanceof Error ? error.message : String(error) };
        attempt += 1;
      }
      if (this.#stopped) {
        return;
      }
      this.#status = { ...this.#status, state: 'waiting' };
      await this.#sleep(backoffDelay(attempt - 1, this.#options.backoffMinMs ?? BACKOFF_MIN_MS,
        this.#options.backoffMaxMs ?? BACKOFF_MAX_MS));
    }
  }

  #target(): URL {
    const url = new URL(this.#options.relayUrl());
    if (url.protocol !== 'https:') {
      throw new TunnelRefused('隧道只走 https 的中继地址');
    }
    return url;
  }

  #dial(url: URL, alpn: string | null): TLSSocket {
    return connect({
      host: this.#options.relayAddress ?? url.hostname,
      port: url.port === '' ? HTTPS_PORT : Number(url.port),
      servername: url.hostname,
      ...(alpn === null ? {} : { ALPNProtocols: [alpn] }),
      ...(this.#options.ca === undefined ? {} : { ca: this.#options.ca }),
    });
  }

  /** 一条控制连接从连上到断开；收到过 hello 返回 true（重连退避从头算）。 */
  #session(signer: Signer): Promise<boolean> {
    const url = this.#target();
    const control = new URL(TUNNEL_PATH, url);
    control.protocol = 'wss:';
    const headers = signedHeaders(signer, 'GET', TUNNEL_PATH, Buffer.alloc(0), this.#options.now());
    const ws = new WebSocket(control, { headers, handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      createConnection: () => this.#dial(url, null) });
    this.#socket = ws;
    const heartbeatMs = this.#options.heartbeatMs ?? TUNNEL_HEARTBEAT_MS;
    const deadMs = this.#options.deadMs ?? TUNNEL_DEAD_MS;
    return new Promise((resolve, reject) => {
      let hello = false;
      let lastHeard = Date.now();
      let refusal: Error | null = null;
      const timer = setInterval(() => {
        if (Date.now() - lastHeard > deadMs) {
          refusal = new Error('中继 60 秒没说话，重连');
          ws.terminate();
          return;
        }
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, heartbeatMs);
      ws.on('unexpected-response', (_request, response) => {
        refusal = new TunnelRefused(`中继拒绝了隧道（${response.statusCode ?? '?'}）`);
        ws.terminate();
      });
      ws.on('error', (error) => {
        refusal ??= error;
      });
      ws.on('message', (data) => {
        lastHeard = Date.now();
        const message = parse(data);
        if (!Value.Check(RelayControlMessageSchema, message)) {
          return;
        }
        hello = this.#handle(url, message) || hello;
        if (hello) {
          this.#status = { state: 'connected', host: this.#status.host, lastError: null };
        }
      });
      ws.once('close', () => {
        clearInterval(timer);
        this.#socket = null;
        if (refusal !== null && !hello) {
          reject(refusal);
          return;
        }
        resolve(hello);
      });
    });
  }

  /** 处理中继的一句话；是 hello 返回 true。 */
  #handle(url: URL, message: RelayControlMessage): boolean {
    switch (message.type) {
      case 'hello':
        this.#status = { ...this.#status, host: message.host };
        this.#options.onHello(message.host);
        return true;
      case 'open':
        this.#openWork(url, message.id);
        return false;
      case 'ping':
        return false;
    }
  }

  #openWork(url: URL, id: string): void {
    const work = this.#dial(url, WORK_ALPN);
    this.#work.add(work);
    work.setKeepAlive(true, KEEPALIVE_MS);
    work.once('close', () => this.#work.delete(work));
    // 工作连接拨不通或中途断了：这一条作废，中继那边到时会再要。
    work.on('error', () => work.destroy());
    work.once('secureConnect', () => {
      work.write(`${id}\n`);
      this.#options.onWork(work);
    });
  }
}
