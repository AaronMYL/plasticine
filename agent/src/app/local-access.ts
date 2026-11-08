// 请求从哪来（2026-11-08《首次使用流程》）：本机令牌只认 127.0.0.1 直连来的；限流按来源数。
// - 直连：连接的地址就是来源。桌面客户端拉起的本体只听 127.0.0.1，壳和本机界面都是直连。
// - 经 Caddy（腾讯云那份）：连接都从 127.0.0.1 来，但带着 X-Forwarded-For；这种不算本机，来源取 Caddy 补的最后一个
//   地址（Caddy 不信外面带来的那一串，自己把真实地址接在最后）。
// - 经隧道（<handle>.cyberhunter.top）：连接是解开的 TLS，没有地址，记成 unknown，不算本机。

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LOCAL_TOKEN_HEADER } from '../../shared/api/account.ts';

const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'];

type RequestLike = Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string | undefined } };

/** 本机回环直连，没经过任何反代。 */
export function fromLoopback(req: RequestLike): boolean {
  return LOOPBACK.has(req.socket.remoteAddress ?? '')
    && FORWARDING_HEADERS.every((name) => req.headers[name] === undefined);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * 请求带的本机令牌对不对：本体配了令牌（PLASTICINE_LOCAL_TOKEN 非空）、请求从 127.0.0.1 直连、请求头和它一样。
 * 比的是两边的 SHA-256（等长），常数时间，长短也不漏。
 */
export function localTokenValid(expected: string | null, req: RequestLike): boolean {
  if (expected === null || expected === '' || !fromLoopback(req)) {
    return false;
  }
  const given = req.headers[LOCAL_TOKEN_HEADER];
  if (typeof given !== 'string' || given === '') {
    return false;
  }
  return timingSafeEqual(digest(given), digest(expected));
}

/** 限流按它数的来源地址。 */
export function requestSource(req: RequestLike): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  if (!LOOPBACK.has(remote) || forwarded === undefined) {
    return remote;
  }
  const chain = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded).split(',');
  const last = chain.at(-1)?.trim() ?? '';
  return last === '' ? remote : last;
}
