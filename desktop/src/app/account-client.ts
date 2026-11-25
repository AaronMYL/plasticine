import { Value } from 'typebox/value';
import { ACCOUNT_STATE_PATH, AccountStateSchema, LOCAL_SESSION_PATH, LOCAL_TOKEN_HEADER, type AccountState }
  from '../../../agent/shared/api/account.ts';
import { SESSION_PATH } from '../../../agent/shared/api/session.ts';
import { LOCAL_SERVER_URL, sameOrigin } from './server-target.ts';

type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 8_000;

export interface CookieDetails {
  url: string;
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  expirationDate?: number;
}

export interface CookieJar {
  get(url: string): Promise<{ name: string; value: string }[]>;
  set(details: CookieDetails): Promise<void>;
}

const SAME_SITE: Readonly<Record<string, CookieDetails['sameSite']>> = { strict: 'strict', lax: 'lax',
  none: 'no_restriction' };

export function parseSetCookie(header: string, url: string, now = Date.now()): CookieDetails | null {
  const [pair = '', ...attributes] = header.split(';');
  const equals = pair.indexOf('=');
  const name = equals > 0 ? pair.slice(0, equals).trim() : '';
  if (name === '') {
    return null;
  }
  const cookie: CookieDetails = { url, name, value: pair.slice(equals + 1).trim(), path: '/', httpOnly: false,
    secure: false, sameSite: 'unspecified' };
  for (const attribute of attributes) {
    const [rawKey = '', ...rest] = attribute.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join('=').trim();
    if (key === 'path' && value.startsWith('/')) {
      cookie.path = value;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'samesite') {
      cookie.sameSite = SAME_SITE[value.toLowerCase()] ?? 'unspecified';
    } else if (key === 'max-age' && /^-?\d+$/.test(value)) {
      cookie.expirationDate = now / 1000 + Number(value);
    } else if (key === 'expires' && cookie.expirationDate === undefined && !Number.isNaN(Date.parse(value))) {
      cookie.expirationDate = Date.parse(value) / 1000;
    }
  }
  return cookie;
}

export function localGrantFor(frameUrl: string, token: string | null): string | null {
  return token !== null && sameOrigin(frameUrl, LOCAL_SERVER_URL) ? token : null;
}

export class PlaceProbeError extends Error {}

export async function probePlace(origin: string, fetchImpl: Fetch): Promise<void> {
  const host = new URL(origin).host;
  const get = async (path: string): Promise<Response> => {
    try {
      return await fetchImpl(new URL(path, origin), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'manual' });
    } catch (error) {
      if (error instanceof Error) {
        throw new PlaceProbeError(`连不上 ${host}，检查一下地址和网络。`, { cause: error });
      }
      throw error;
    }
  };
  const state = await get(ACCOUNT_STATE_PATH);
  if (state.ok) {
    return;
  }
  if (state.status === 404 && (await get('/v2/health')).ok) {
    return;
  }
  throw new PlaceProbeError(`${host} 上没找到 Plasticine（回了 ${state.status}），检查一下地址。`);
}

async function accountState(origin: string, fetchImpl: Fetch): Promise<AccountState | null> {
  const response = await fetchImpl(new URL(ACCOUNT_STATE_PATH, origin),
    { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`账号状态回了 ${response.status}`);
  }
  const body: unknown = await response.json();
  if (!Value.Check(AccountStateSchema, body)) {
    throw new Error('账号状态的形状不对');
  }
  return body;
}

interface LocalSignIn {
  origin: string;
  token: string;
  deviceName: string;
  fetch: Fetch;
  jar: CookieJar;
}

async function signInLocally(input: LocalSignIn): Promise<void> {
  const cookies = await input.jar.get(input.origin);
  if (cookies.length > 0) {
    const current = await input.fetch(new URL(SESSION_PATH, input.origin), {
      headers: { cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (current.ok) {
      return;
    }
  }
  const response = await input.fetch(new URL(LOCAL_SESSION_PATH, input.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', [LOCAL_TOKEN_HEADER]: input.token },
    body: JSON.stringify({ deviceName: input.deviceName }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`本体回了 ${response.status}`);
  }
  const headers = response.headers.getSetCookie();
  if (headers.length === 0) {
    throw new Error('本体没给会话 Cookie');
  }
  for (const header of headers) {
    const cookie = parseSetCookie(header, input.origin);
    if (cookie !== null) {
      await input.jar.set(cookie);
    }
  }
}

export async function enterLocal(input: LocalSignIn & { log(line: string): void }): Promise<string> {
  let state: AccountState | null;
  try {
    state = await accountState(input.origin, input.fetch);
  } catch (error) {
    input.log(`没问到本机 Plasticine 的账号状态：${error instanceof Error ? error.message : String(error)}`);
    return '';
  }
  if (state === null) {
    return '';
  }
  if (state.setup === 'needed') {
    return '#/setup';
  }
  try {
    await signInLocally(input);
  } catch (error) {
    input.log(`本机自动登录没成：${error instanceof Error ? error.message : String(error)}`);
  }
  return '';
}
