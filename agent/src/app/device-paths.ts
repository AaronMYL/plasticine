// 登录着的设备是怎么连进来的（11-12《首次使用解耦》设置 · 账号「登录着的设备」）：本机 / 直连 / 经中继 / 自己的网址。
// 只记在内存里（重启后要等那台再来一次才知道），不进库：这是「现在」的状态，不是历史。
// - 经中继：隧道解开的连接（app.ts 交给 HTTP 服务前登记在这里）；
// - 直连：直连通道转给本体的请求（direct/channel.ts 带着本进程的记号）；
// - 本机：127.0.0.1 直连、主机名也是本机；
// - 其余（自己的反向代理、Tailscale、腾讯云上的 Caddy）算「自己的网址」。

import type { IncomingMessage } from 'node:http';
import type { DeviceVia } from '../../shared/api/devices.ts';
import { DIRECT_MARKER_HEADER } from '../direct/channel.ts';
import { fromLoopback } from './local-access.ts';

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class DevicePaths {
  readonly #tunnel = new WeakSet<object>();
  readonly #seen = new Map<string, DeviceVia>();
  readonly #marker: string | null;

  /** marker：直连转请求时带的记号（direct/hub.ts）；不给就不认直连。 */
  constructor(marker: string | null = null) {
    this.#marker = marker;
  }

  /** 隧道解开的一条连接。 */
  markTunnel(socket: object): void {
    this.#tunnel.add(socket);
  }

  pathOf(req: IncomingMessage): DeviceVia {
    if (this.#marker !== null && req.headers[DIRECT_MARKER_HEADER] === this.#marker) return 'direct';
    if (this.#tunnel.has(req.socket)) return 'relay';
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    return fromLoopback(req) && LOCAL_HOSTS.has(host) ? 'local' : 'web';
  }

  /** 登录过的请求进来：记下这台这次怎么连的。 */
  see(deviceId: string, req: IncomingMessage): void {
    this.#seen.set(deviceId, this.pathOf(req));
  }

  of(deviceId: string): DeviceVia | undefined {
    return this.#seen.get(deviceId);
  }
}
