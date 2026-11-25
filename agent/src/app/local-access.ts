import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { LOCAL_TOKEN_HEADER } from '../../shared/api/account.ts';

const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDING_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'];

type RequestLike = Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string | undefined } };

export function fromLoopback(req: RequestLike): boolean {
  return LOOPBACK.has(req.socket.remoteAddress ?? '')
    && FORWARDING_HEADERS.every((name) => req.headers[name] === undefined);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

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
