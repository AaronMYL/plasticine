// 外部链接的唯一清洗规则（10-28）：保留文章查询参数，只去掉凭据名、嵌套 URL 和像令牌的值。
// 写入、迁移、视图与缓存重放都调用这里；不把 URL 解析错误的原文或 cause 带到日志。

import { FEED_URL_MAX_CHARS } from '../../shared/state.ts';
import { shownError } from './errors.ts';

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

/** The cleaned link, or a DailyError (shownError) naming `field`. */
export function cleanUrl(raw: string, field = 'url'): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // The text itself is not echoed: a malformed link may still carry a token, and errors reach logs.
    // Not even as the cause: node's URL error keeps the input text.
    throw shownError('invalid_input', '链接不是完整的网址；请用 https:// 或 http:// 开头的地址。', field);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw shownError('invalid_input', '链接只收 http / https 地址。', field);
  }
  url.username = '';
  url.password = '';
  // 只筛掉有问题的那一对，不重新序列化安全参数，保留名称大小写、编码、顺序和同名的安全值。
  const query = url.search.slice(1);
  const cleanedQuery = cleanUrlQuery(query);
  if (cleanedQuery !== query) {
    url.search = cleanedQuery;
  }
  url.hash = '';
  const cleaned = url.toString();
  if (cleaned.length > FEED_URL_MAX_CHARS) {
    throw shownError('invalid_input', `链接超过 ${FEED_URL_MAX_CHARS} 个字符。`, field);
  }
  return cleaned;
}

/** The host of a cleaned link (信息源的「最近来源」). */
export function siteOf(url: string): string {
  return new URL(cleanUrl(url)).host;
}
