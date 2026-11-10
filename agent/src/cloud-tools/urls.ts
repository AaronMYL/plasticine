// 外部输入的网址先过这里（审查 P1：外部输入没校验）：云端浏览器只开 https 的公网地址——不带用户名密码、不是本机、
// 不是内网或链路本地地址、不是 .local / .internal 这类只在内网有意义的名字。写进日志、事件和回答的网址去掉查询串和片段，
// 免得带着令牌出去。

import { isIP } from 'node:net';
import { CloudToolError } from './errors.ts';

export const URL_MAX_CHARS = 3_000;
const PRIVATE_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet'];

function privateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateIPv6(host: string): boolean {
  // DNS 可给完整写法，URL 会把 IPv4 映射地址改成十六进制；先统一再校验，不能漏过映射的内网地址。
  const bare = new URL(`https://[${host.replace(/^\[|\]$/g, '')}]/`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === '::' || bare === '::1') {
    return true;
  }
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(bare);
  if (mapped?.[1] !== undefined && mapped[2] !== undefined) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return privateIPv4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(bare);
}

/** Whether a host name or address is only meaningful inside this machine or a private network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  const bare = host.replace(/^\[|\]$/g, '');
  const family = isIP(bare);
  if (family === 4) {
    return privateIPv4(bare);
  }
  if (family === 6) {
    return privateIPv6(bare);
  }
  // A single label (no dot) resolves inside the local network, if at all.
  return !host.includes('.');
}

/** The URL if it may be opened from the cloud; refuses anything else with the reason. */
export function checkPublicHttpsUrl(raw: string, field = 'url'): URL {
  if (raw.length > URL_MAX_CHARS) {
    throw new CloudToolError('invalid_input', `网址太长了（最多 ${URL_MAX_CHARS} 个字符）。`, field);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new CloudToolError('invalid_input', '这不是一个完整的网址。', field);
    }
    throw error;
  }
  if (url.protocol !== 'https:') {
    throw new CloudToolError('invalid_input', '只开 https:// 开头的网址。', field);
  }
  if (url.username !== '' || url.password !== '') {
    throw new CloudToolError('invalid_input', '网址里带着用户名或密码，没有打开；把账号从网址里去掉。', field);
  }
  if (isPrivateHost(url.hostname)) {
    throw new CloudToolError('invalid_input', '这是本机或内网的地址，云端浏览器不开。', field);
  }
  return url;
}

/** Scheme, host and path only: what may go into a log line, an event or a stored record. */
export function displayUrl(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}
