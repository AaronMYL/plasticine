// 链接规则在 urls.ts；这里把它应用到 M4 的文字、站点字段与旧 JSON 存档，避免旁路字段留下完整 URL。
import { errorCategory, safeLog } from '../shared-log.ts';
import { EXTERNAL_LINK, splitLink } from '../link-text.ts';
import { DailyError } from './errors.ts';
import { cleanUrl, siteOf } from './urls.ts';

const SITE_FIELDS = new Set(['site', 'host', 'hostname', 'blockedsites']);

/** 旧记录可能无效：只记录错误类别，输出不回退到原始输入。新加的主链接仍由 cleanUrl 严格校验。 */
export function safeUrl(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') {
    return null;
  }
  try {
    return cleanUrl(raw);
  } catch (error) {
    if (!(error instanceof DailyError)) {
      throw error;
    }
    safeLog('warn', 'feed_url_rejected', { category: errorCategory(error) });
    return null;
  }
}

/** 站点旧值可能是主机名，也可能是完整 URL；输出只含 host，绝不沿用原文。 */
export function cleanSite(raw: string): string | null {
  const text = raw.trim();
  let candidate = text;
  if (text.startsWith('//')) {
    candidate = `https:${text}`;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(text) || /^[^/:]+:\d+(?:[/#?]|$)/.test(text)) {
    candidate = `https://${text}`;
  }
  const url = safeUrl(candidate);
  return url === null ? null : siteOf(url);
}

export function cleanLinkText(text: string): string {
  return text.replace(EXTERNAL_LINK, (raw) => {
    const { link, suffix } = splitLink(raw);
    return (safeUrl(link.startsWith('//') ? `https:${link}` : link) ?? '') + suffix;
  });
}

function cleanData(value: unknown, field: string): unknown {
  if (typeof value === 'string') {
    if (SITE_FIELDS.has(field)) {
      return value === '' ? '' : (cleanSite(value) ?? '');
    }
    if (field === 'url' || field === 'href') {
      return safeUrl(value) ?? '';
    }
    // source 可以是站点或普通标签，只有明确的 URL 才按主机处理。
    if (field === 'source' && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value.trim())) {
      return cleanSite(value) ?? '';
    }
    return cleanLinkText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cleanData(entry, field));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cleanData(entry, key.toLowerCase())]));
  }
  return value;
}

/** 保持 JSON 形状，只替换其中的链接字符串；不修改传入的对象或旧缓存。 */
export function cleanLinkData<T>(value: T): T {
  return cleanData(value, '') as T;
}

/** 来源视图和存储共用：blocked_site 的 label 是主机，ref 保留 blocked: 前缀。 */
export function cleanSourceLinks<T extends { kind: string; label: string; ref?: string | null }>(source: T): T {
  const cleaned = cleanLinkData(source);
  if (source.kind === 'blocked_site') {
    cleaned.label = cleanSite(source.label) ?? '无效站点';
    if (source.ref?.startsWith('blocked:')) {
      cleaned.ref = `blocked:${cleanSite(source.ref.slice('blocked:'.length)) ?? 'invalid'}`;
    }
  }
  return cleaned;
}
