import type { IncomingMessage } from 'node:http';
import type { DeviceVia } from '../../shared/api/devices.ts';
import { DIRECT_MARKER_HEADER } from '../direct/index.ts';
import { fromLoopback } from './local-access.ts';

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class DevicePaths {
  readonly #tunnel = new WeakSet<object>();
  readonly #seen = new Map<string, DeviceVia>();
  readonly #marker: string | null;

  constructor(marker: string | null = null) {
    this.#marker = marker;
  }

  markTunnel(socket: object): void {
    this.#tunnel.add(socket);
  }

  pathOf(req: IncomingMessage): DeviceVia {
    if (this.#marker !== null && req.headers[DIRECT_MARKER_HEADER] === this.#marker) return 'direct';
    if (this.#tunnel.has(req.socket)) return 'relay';
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    return fromLoopback(req) && LOCAL_HOSTS.has(host) ? 'local' : 'web';
  }

  see(deviceId: string, req: IncomingMessage): void {
    this.#seen.set(deviceId, this.pathOf(req));
  }

  of(deviceId: string): DeviceVia | undefined {
    return this.#seen.get(deviceId);
  }
}
