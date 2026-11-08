// 主进程替界面问本体的几件事（11-08 首次使用流程，接口在 agent/shared/api/account.ts）：
// - 连远程之前先探一下地址到不到得了（开始页就地报原因）。
// - 本机本体起来以后按账号状态决定进哪一页：还没有主人进建账号页；有主人就凭本机令牌替界面登录，把会话 Cookie
//   写进界面视图的 session，他不会看到登录页。
// - 本机令牌只给载入本机本体（同源 127.0.0.1:8790）的界面。
// 令牌和会话 Cookie 不进日志。

import { Value } from 'typebox/value';
import { ACCOUNT_STATE_PATH, AccountStateSchema, LOCAL_SESSION_PATH, LOCAL_TOKEN_HEADER, type AccountState }
  from '../../../agent/shared/api/account.ts';
import { SESSION_PATH } from '../../../agent/shared/api/session.ts';
import { LOCAL_SERVER_URL, sameOrigin } from './server-target.ts';

type Fetch = typeof fetch;

/** 探远程地址、问本机本体都不该卡住开始页太久。 */
const REQUEST_TIMEOUT_MS = 8_000;

/** Electron 的 session.cookies.set 参数（electron 的类型这里不引，测试不起 Electron）。 */
export interface CookieDetails {
  url: string;
  name: string;
  value: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
  /** 秒（Unix 时间）；没有是会话 Cookie。 */
  expirationDate?: number;
}

export interface CookieJar {
  get(url: string): Promise<{ name: string; value: string }[]>;
  set(details: CookieDetails): Promise<void>;
}

const SAME_SITE: Readonly<Record<string, CookieDetails['sameSite']>> = { strict: 'strict', lax: 'lax',
  none: 'no_restriction' };

/** 一条 Set-Cookie 拆成 cookies.set 的参数；拆不出名字就是 null。 */
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

/** 界面当前地址是本机本体（同源 127.0.0.1:8790）才给本机令牌，否则 null。 */
export function localGrantFor(frameUrl: string, token: string | null): string | null {
  return token !== null && sameOrigin(frameUrl, LOCAL_SERVER_URL) ? token : null;
}

export class PlaceProbeError extends Error {}

/**
 * 连上之前探一下：GET /v2/account/state 答上就行；旧版本体还没有账号接口（404）时看 /v2/health。到不了给一句原因。
 */
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

/** 本体的账号状态；本体还没有账号接口（旧版）是 null。 */
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

/** 界面视图里的会话还有效就不再登记一次设备；否则凭本机令牌登录，Set-Cookie 写进界面视图的 session。 */
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

/**
 * 本机本体答上以后进哪一页（拼在本机地址后面）：还没有主人是 #/setup；有主人先替界面登录再进首页。问不到、登录
 * 没成都只记一句，照旧载入（界面自己会显示登录页），不把他挡在开始页。
 */
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
