// 开始页「连到我的 Plasticine」那一格（11-08 首次使用流程）：@账号或地址都认。不带点、冒号、斜杠的当 @账号，换成
// https://<账号>.cyberhunter.top/；其余当地址，照 normalizeRemoteUrl 只收 https 源地址。纯逻辑，开始页和主进程共用。

import { normalizeRemoteUrl, RemoteUrlError } from './server-target.ts';

/** Cyber Hunter 网络的主域名：@账号的网址是 <账号>.<这个>（和中继 agent/protocol/relay-client.ts 一致）。 */
export const NETWORK_DOMAIN = 'cyberhunter.top';
/**
 * 和 agent/shared/api/account.ts 的 HandleSchema 同一条规则（和中继一致：小写字母、数字、下划线，3–24 位；这里不引
 * typebox：开始页是浏览器里的静态页）。域名里不能有下划线：网址里换成连字符，从网址读回时再换回来。
 */
const HANDLE = /^[a-z0-9_]{3,24}$/;
const HOST_LABEL = /^[a-z0-9-]{3,24}$/;

/** @账号对应的网址主机名部分。 */
export function handleHost(handle: string): string {
  return handle.replace(/_/g, '-');
}

export class PlaceAddressError extends Error {}

export interface PlaceAddress {
  /** 规整好的 https 源地址（带结尾斜杠）。 */
  url: string;
  /** 写的是 @账号时的账号；写地址时是 null。 */
  handle: string | null;
}

export function parsePlaceAddress(input: string): PlaceAddress {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new PlaceAddressError('填你的 @账号，或 Plasticine 的地址。');
  }
  if (/[.:/]/.test(trimmed)) {
    try {
      return { url: normalizeRemoteUrl(trimmed), handle: null };
    } catch (error) {
      if (error instanceof RemoteUrlError) {
        throw new PlaceAddressError('地址要是 https:// 开头的网址，比如 https://你的账号.cyberhunter.top。',
          { cause: error });
      }
      throw error;
    }
  }
  const handle = trimmed.replace(/^@/, '').toLowerCase();
  if (!HANDLE.test(handle)) {
    throw new PlaceAddressError('@账号是 3–24 位小写字母、数字或下划线。');
  }
  return { url: `https://${handleHost(handle)}.${NETWORK_DOMAIN}/`, handle };
}

/** 地址框里预填的样子：@账号的网址写回 @账号，别的地址去掉 https:// 和结尾斜杠。 */
export function displayPlace(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    if (error instanceof TypeError) {
      return '';
    }
    throw error;
  }
  const suffix = `.${NETWORK_DOMAIN}`;
  const label = parsed.hostname.endsWith(suffix) ? parsed.hostname.slice(0, -suffix.length) : '';
  if (parsed.port === '' && HOST_LABEL.test(label)) {
    return `@${label.replace(/-/g, '_')}`;
  }
  return parsed.host;
}
