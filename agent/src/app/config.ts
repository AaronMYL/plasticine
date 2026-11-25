export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 8790;
export const DATABASE_FILE = 'plasticine.sqlite';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const SESSION_COOKIE = 'plasticine_session';
export const SESSION_TTL_MS = 400 * 24 * 60 * 60 * 1000;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;
export const PAIRING_FAILURE_LIMIT = 10;
export const PAIRING_FAILURE_WINDOW_MS = 10 * 60 * 1000;
export const PASSWORD_FAILURE_LIMIT = PAIRING_FAILURE_LIMIT;
export const PASSWORD_FAILURE_WINDOW_MS = PAIRING_FAILURE_WINDOW_MS;
export const PASSWORD_GLOBAL_FAILURE_LIMIT = 30;

export const SSE_HEARTBEAT_MS = 25 * 1000;
export const EVENT_BUFFER_SIZE = 5_000;
export const SSE_RETRY_MS = 3_000;
export const SSE_MAX_PENDING_BYTES = 1024 * 1024;

export const DEFAULT_VAPID_SUBJECT = 'https://cyberhunter.top';

export const SHUTDOWN_GRACE_MS = 60 * 1000;
