// 往外送的链接清洗（10-28 定的规则；11-14 Aaron 改成「自己用不清洗，分享出去才清洗」）：只用在往外送的地方——分享给
// 联系人和群组、写进来信、推送、记日志，还有拿链接比对去重的键。库里存的、回给他自己设备的都是原链接。
// 保留文章参数，只去掉名字像凭据的参数、套着的网址和像令牌的值；不依赖别的模块（日志也要用它，不能绕成环）。

import { EXTERNAL_LINK, splitLink } from './link-text.ts';

const CREDENTIAL_WORDS = [
  'token', 'secret', 'key', 'sig', 'auth', 'pass', 'pwd', 'session', 'sid', 'cred', 'code', 'bearer', 'jwt', 'otp',
];
// 沿用完整单词的歧义豁免（如 keyword 含 key）；其前后缀仍检查，参数值没有豁免。
const PUBLIC_WORDS = new Set(['keyword', 'monkey', 'passage', 'author']);
// 用户 10-28 定：值最多解码三层，32 位起算长令牌，40 位以内的纯十六进制摘要保留。
const MAX_DECODE_LAYERS = 3;
const TOKEN_MIN_CHARS = 32;
const HEX_DIGEST_MAX_CHARS = 40;
const LONG_TOKEN = new RegExp(`[a-zA-Z0-9+/_-]{${TOKEN_MIN_CHARS},}`);
const HEX_DIGEST = new RegExp(`^[a-fA-F0-9]{1,${HEX_DIGEST_MAX_CHARS}}$`);
const JWT_SHAPE = /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/;
const URL_SHAPE = /[a-z][a-z0-9+.-]*:\/\/|\/\/[^\s/]/i;
const PERCENT_ESCAPE = /%[a-f0-9]{2}/i;

export function isCredentialParam(name: string): boolean {
  const normalized = name.normalize('NFKC').toLowerCase().replace(/[-_.]/g, '');
  return !PUBLIC_WORDS.has(normalized) && CREDENTIAL_WORDS.some((word) => normalized.includes(word));
}

function unsafeValue(value: string): boolean {
  // URLSearchParams 已解一层；每层都检查，最多再解两层，不能完整检查的编码值不保留。
  for (let layer = 1; layer <= MAX_DECODE_LAYERS; layer += 1) {
    const normalized = value.normalize('NFKC').trim();
    if (URL_SHAPE.test(normalized) || JWT_SHAPE.test(normalized)) {
      return true;
    }
    // 微信 sn 等文章摘要常有 32 / 40 位；只豁免整个值为纯十六进制，凭据参数名仍先被拦下。
    if (LONG_TOKEN.test(normalized) && !HEX_DIGEST.test(normalized)) {
      return true;
    }
    if (!PERCENT_ESCAPE.test(value)) {
      return false;
    }
    if (layer === MAX_DECODE_LAYERS) {
      return true;
    }
    try {
      value = decodeURIComponent(value);
    } catch {
      return true;
    }
  }
  return false;
}

/** 参数筛选与正文链接共用；返回原始安全参数，不重新编码、排序或合并重复键。 */
export function cleanUrlQuery(query: string): string {
  return query.split('&').filter((pair) => {
    const entry = new URLSearchParams(pair).entries().next().value;
    return entry === undefined || (!isCredentialParam(entry[0]) && !unsafeValue(entry[1]));
  }).join('&');
}

function cleanFragment(fragment: string): string {
  // 页面路由和普通锚点是内容位置；只有参数形式的认证片段整段清除。
  if (fragment.startsWith('#/') || !fragment.includes('=')) {
    return fragment;
  }
  for (const name of new URLSearchParams(fragment.slice(1)).keys()) {
    if (isCredentialParam(name) || name.normalize('NFKC').toLowerCase() === 'state') {
      return '';
    }
  }
  return fragment;
}

function cleanMatchedLink(raw: string): string {
  const { link, suffix } = splitLink(raw);
  // 正文只裁掉确定要清洗的部分，不用 URL.toString() 重写用户文字。
  // 无效主机、端口或非 HTTP 协议同样按边界裁剪，不因解析失败删掉整段。
  const hashAt = link.indexOf('#');
  const withoutHash = hashAt < 0 ? link : link.slice(0, hashAt);
  const fragment = hashAt < 0 ? '' : cleanFragment(link.slice(hashAt));
  const queryAt = withoutHash.indexOf('?');
  const base = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
  let search = queryAt < 0 ? '' : withoutHash.slice(queryAt);
  if (search !== '') {
    const query = search.slice(1);
    const cleaned = cleanUrlQuery(query);
    if (cleaned !== query) {
      search = cleaned === '' ? '' : `?${cleaned}`;
    }
  }
  const authorityStart = base.indexOf('//') + 2;
  const slashAt = base.indexOf('/', authorityStart);
  const authorityEnd = slashAt < 0 ? base.length : slashAt;
  const authority = base.slice(authorityStart, authorityEnd);
  const userinfoAt = authority.lastIndexOf('@');
  const cleanedBase = userinfoAt < 0 ? base
    : base.slice(0, authorityStart) + authority.slice(userinfoAt + 1) + base.slice(authorityEnd);
  const cleaned = cleanedBase + search + fragment;
  return cleaned === link ? raw : cleaned + suffix;
}

export function cleanOutboundText(text: string): string {
  // userinfo 只属于 scheme:// 或 // 开头的链接；10:30@会议室、a:b@c 等普通文字不碰。
  return text.includes('//') ? text.replace(EXTERNAL_LINK, cleanMatchedLink) : text;
}
