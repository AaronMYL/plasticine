// @账号的写法（11-08 首次使用流程）：规整、格式、对应的网址。纯函数，登录页、建账号页、下载页共用。

import { Value } from 'typebox/value';
import { HandleSchema } from '../../api/shared.ts';

/** @账号对应的网址后缀（中继的主域名，agent/protocol/relay-client.ts 的默认中继）。 */
export const HANDLE_DOMAIN = 'cyberhunter.top';

/** @账号对应的网址主机名：域名里不能有下划线，换成连字符（和中继、服务端同一条）。 */
export function handleHost(handle: string): string {
  return `${handle.replace(/_/g, '-')}.${HANDLE_DOMAIN}`;
}

/** 输入里的写法规整成 @账号：去掉 @、空格，转小写。 */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, '').replace(/\s+/g, '').toLowerCase();
}

export function validHandle(handle: string): boolean {
  return Value.Check(HandleSchema, handle);
}

export type LoginTarget = { kind: 'here' } | { kind: 'elsewhere'; url: string } | { kind: 'bad' };

/**
 * 填的是哪一份：空的、这一份的 @账号（here 给了时）或这个网址是这里；别的 @账号、地址是它的登录页；认不出是 bad。
 * hereHandle 为 undefined 表示不知道这一份是谁（读不到账号状态）：@账号一律当这里。
 */
export function loginTarget(input: string, hereHandle: string | null | undefined, here: URL | null): LoginTarget {
  const value = input.trim();
  if (value === '') {
    return here === null ? { kind: 'bad' } : { kind: 'here' };
  }
  const handle = normalizeHandle(value);
  if (!/[.:/]/.test(value)) {
    if (!validHandle(handle)) return { kind: 'bad' };
    if (here !== null && (hereHandle === undefined || hereHandle === handle)) return { kind: 'here' };
    return { kind: 'elsewhere', url: `https://${handleHost(handle)}/#/login` };
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch (cause) {
    if (cause instanceof TypeError) return { kind: 'bad' };
    throw cause;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') {
    return { kind: 'bad' };
  }
  if (here !== null && url.host === here.host) {
    return { kind: 'here' };
  }
  return { kind: 'elsewhere', url: `${url.origin}/#/login` };
}
