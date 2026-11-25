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
import { errorCategory, safeLog } from '../util/index.ts';

export interface DirectPipe {
  send(data: string | Uint8Array): void;
  bufferedAmount(): number;
  drained(): Promise<void>;
}

export interface DirectTarget {
  port: number;
  cookie: string;
  host: string;
  marker: string;
}

export const DIRECT_MARKER_HEADER = 'x-plasticine-direct';
const MAX_IN_FLIGHT = 64;
const HIGH_WATER = 1024 * 1024;
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
    const framed = body ? { ...headers, 'transfer-encoding': 'chunked' } : headers;
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers: framed }, (res) => {
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
