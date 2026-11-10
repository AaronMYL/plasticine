// 只在呈现和发送边界使用；复制 JSON，不回写库、回执缓存或 SSE 缓冲。参数规则与 daily/ 的 cleanUrl 共用。
import { cleanUrlQuery, isCredentialParam } from './daily/index.ts';
import { EXTERNAL_LINK, splitLink } from './link-text.ts';

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

export type PreserveOutboundField = (parent: Readonly<Record<string, unknown>>, key: string) => boolean;

/** 默认清洗所有字符串；只有认证接口的序列化边界可以明确指定用户原文字段。 */
export function cleanOutboundJson<T>(value: T, preserve?: PreserveOutboundField): T {
  if (typeof value === 'string') {
    return cleanOutboundText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry: unknown, index) => {
      const keep = typeof entry === 'string' && preserve?.(value as unknown as Record<string, unknown>, String(index));
      return keep ? entry : cleanOutboundJson(entry, preserve);
    }) as T;
  }
  if (typeof value === 'object' && value !== null) {
    const parent = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parent).map(([key, entry]) => {
      const keep = typeof entry === 'string' && preserve?.(parent, key);
      return [key, keep ? entry : cleanOutboundJson(entry, preserve)];
    })) as T;
  }
  return value;
}
