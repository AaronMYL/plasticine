// 直连通道这一头（11-12《首次使用解耦》）：通道里来一个请求帧，就照样发一个 HTTP 请求给本机的本体（127.0.0.1），
// 带上握手那次的会话 cookie 和一个只有本进程知道的记号（登录着的设备据此标「直连」），回应原样切成块发回去。
// 这样鉴权、限流、接口逻辑都和普通请求是同一套，不另写一份。只带白名单里的请求头；登录、账号类接口不走这里。

import { request, type ClientRequest, type IncomingMessage } from 'node:http';
import { Value } from 'typebox/value';
import {
  DIRECT_CHUNK_BYTES,
  DIRECT_FORWARD_HEADERS,
  DirectFrameSchema,
  decodeChunk,
  directAllowed,
  encodeChunk,
  type DirectFrame,
} from '../../shared/api/direct.ts';
import { errorCategory, safeLog } from '../shared-log.ts';

/** 通道的抽象（werift 的数据通道、测试里的假通道都满足）。 */
export interface DirectPipe {
  send(data: string | Uint8Array): void;
  bufferedAmount(): number;
  /** 发出去的缓冲降下来时回调一次。 */
  drained(): Promise<void>;
}

/** 请求发到哪：本体的端口、会话 cookie、对外的主机名、记号。 */
export interface DirectTarget {
  port: number;
  cookie: string;
  host: string;
  marker: string;
}

export const DIRECT_MARKER_HEADER = 'x-plasticine-direct';
/** 一条通道同时最多这么多个请求在途。 */
const MAX_IN_FLIGHT = 64;
/** 缓冲超过这么多就先停读本体的回应，等通道发出去一些。 */
const HIGH_WATER = 1024 * 1024;
/** 回应头里不往回带的（连接层的、cookie）。 */
const DROP_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'set-cookie',
  'content-encoding', 'content-length']);

function forwardHeaders(given: Record<string, string>, target: DirectTarget): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of DIRECT_FORWARD_HEADERS) {
    const value = given[name];
    if (value !== undefined) headers[name] = value;
  }
  headers['cookie'] = target.cookie;
  headers['host'] = target.host;
  headers['accept-encoding'] = 'identity';
  headers[DIRECT_MARKER_HEADER] = target.marker;
  return headers;
}

function responseHeaders(res: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined || DROP_RESPONSE_HEADERS.has(name)) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

export class DirectChannelServer {
  readonly #pipe: DirectPipe;
  readonly #target: () => DirectTarget | null;
  readonly #inFlight = new Map<number, ClientRequest>();
  #closed = false;

  constructor(pipe: DirectPipe, target: () => DirectTarget | null) {
    this.#pipe = pipe;
    this.#target = target;
  }

  /** 通道里来了一条消息。 */
  receive(message: string | Uint8Array): void {
    if (this.#closed) return;
    if (typeof message !== 'string') {
      this.#chunk(message);
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }
    if (!Value.Check(DirectFrameSchema, frame)) return;
    this.#frame(frame);
  }

  close(): void {
    this.#closed = true;
    for (const pending of this.#inFlight.values()) pending.destroy();
    this.#inFlight.clear();
  }

  #frame(frame: DirectFrame): void {
    switch (frame.t) {
      case 'req': {
        const target = this.#target();
        if (target === null || !directAllowed(frame.path) || this.#inFlight.size >= MAX_IN_FLIGHT
          || this.#inFlight.has(frame.id)) {
          this.#send({ t: 'err', id: frame.id });
          return;
        }
        this.#start(frame.id, frame.method, frame.path, forwardHeaders(frame.headers, target), target.port,
          frame.body);
        return;
      }
      case 'end':
        this.#inFlight.get(frame.id)?.end();
        return;
      case 'abort': {
        const pending = this.#inFlight.get(frame.id);
        this.#inFlight.delete(frame.id);
        pending?.destroy();
        return;
      }
      default:
        return;
    }
  }

  #chunk(message: Uint8Array): void {
    let decoded: { id: number; data: Uint8Array };
    try {
      decoded = decodeChunk(message);
    } catch {
      return;
    }
    this.#inFlight.get(decoded.id)?.write(decoded.data);
  }

  #start(id: number, method: string, path: string, headers: Record<string, string>, port: number,
    body: boolean): void {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      void this.#relay(id, res);
    });
    this.#inFlight.set(id, outgoing);
    outgoing.on('error', (error) => {
      if (this.#inFlight.get(id) !== outgoing) return;
      this.#inFlight.delete(id);
      safeLog('warn', 'direct_forward_failed', { category: errorCategory(error) });
      this.#send({ t: 'err', id });
    });
    if (!body) outgoing.end();
  }

  async #relay(id: number, res: IncomingMessage): Promise<void> {
    this.#send({ t: 'res', id, status: res.statusCode ?? 502, headers: responseHeaders(res) });
    try {
      for await (const piece of res) {
        if (this.#closed || !this.#inFlight.has(id)) {
          res.destroy();
          return;
        }
        const bytes = piece as Uint8Array;
        for (let offset = 0; offset < bytes.byteLength; offset += DIRECT_CHUNK_BYTES) {
          this.#pipe.send(encodeChunk(id, bytes.subarray(offset, offset + DIRECT_CHUNK_BYTES)));
        }
        if (this.#pipe.bufferedAmount() > HIGH_WATER) {
          await this.#pipe.drained();
        }
      }
      if (this.#inFlight.delete(id)) this.#send({ t: 'end', id });
    } catch (error) {
      if (this.#inFlight.delete(id)) {
        safeLog('warn', 'direct_response_failed', { category: errorCategory(error) });
        this.#send({ t: 'err', id });
      }
    }
  }

  #send(frame: DirectFrame): void {
    if (this.#closed) return;
    try {
      this.#pipe.send(JSON.stringify(frame));
    } catch (error) {
      safeLog('warn', 'direct_send_failed', { category: errorCategory(error) });
    }
  }
}
