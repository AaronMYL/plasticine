// Numbers of the HTTP service, each with where it comes from. The service listens only on the loopback address:
// a reverse proxy on the same host (Caddy, agent/deploy/Caddyfile) or the install package serves it to the network.

export const HOST = '127.0.0.1';
// Free on a typical host (Caddy holds 80 / 443); PLASTICINE_PORT overrides it.
export const DEFAULT_PORT = 8790;
export const DATABASE_FILE = 'plasticine.sqlite';

export { DEFAULT_PUBLIC_URL } from '../../shared/public-url.ts';
import { DEFAULT_PUBLIC_URL } from '../../shared/public-url.ts';

export function publicUrlFromEnv(env: Record<string, string | undefined> = process.env): string {
  const url = new URL(env['PLASTICINE_PUBLIC_URL'] ?? DEFAULT_PUBLIC_URL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') {
    throw new Error('PLASTICINE_PUBLIC_URL 要填不带登录信息、查询参数或 hash 的网页地址。');
  }
  return url.href.replace(/\/$/, '');
}

// A note may hold 400 000 characters (old limit); in UTF-8 Chinese that is 1.2 MB, plus JSON escaping.
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const SESSION_COOKIE = 'plasticine_session';
// Browsers cap a cookie's Max-Age at 400 days (RFC 6265bis); the session lasts as long as its cookie can.
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
// Decision 90 ② and the task brief: a pairing code is good for 10 minutes and one use.
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
// Writing "last seen" on every request would turn each read into a write; once a minute is precise enough.
export const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;
// Wrong codes before pairing pauses for everyone. A code has 32^8 ≈ 10^12 values and lives 10 minutes, so 10
// guesses per 10 minutes make a lucky guess practically impossible while a typo or two still goes through.
export const PAIRING_FAILURE_LIMIT = 10;
export const PAIRING_FAILURE_WINDOW_MS = 10 * 60 * 1000;

// Proxies drop a silent connection after about a minute; a comment line every 25 seconds keeps the stream open.
export const SSE_HEARTBEAT_MS = 25 * 1000;
// Events kept for Last-Event-ID replay. One reply streams a few hundred deltas, so this covers several turns.
export const EVENT_BUFFER_SIZE = 5_000;
// How the browser waits before reconnecting a dropped stream.
export const SSE_RETRY_MS = 3_000;
// Unsent bytes one stream may hold: a few hundred events. A client further behind is cut off and replays from its
// Last-Event-ID instead of growing this process's memory (review-followups 908a81e).
export const SSE_MAX_PENDING_BYTES = 1024 * 1024;

// RFC 8292 `sub` for Web Push: how a push service reaches whoever runs this server. Set PLASTICINE_VAPID_SUBJECT to
// your own https:// address (or mailto:); the default is the product site. Never the user's e-mail.
export const DEFAULT_VAPID_SUBJECT = 'https://cyberhunter.top';

// On SIGTERM the service gets this long to stop (lines stop at once and resume after the restart). Kept below the
// systemd unit's TimeoutStopSec (90 s) so the database is always closed by the service itself.
export const SHUTDOWN_GRACE_MS = 60 * 1000;
