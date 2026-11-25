import { errorCategory, EXTERNAL_LINK, safeLog, splitLink } from '../util/index.ts';
import { DailyError } from './errors.ts';
import { checkUrl, siteOf } from './urls.ts';

const SITE_FIELDS = new Set(['site', 'host', 'hostname', 'blockedsites']);

export function safeUrl(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') {
    return null;
  }
  try {
    return checkUrl(raw);
  } catch (error) {
    if (!(error instanceof DailyError)) {
      throw error;
    }
    safeLog('warn', 'feed_url_rejected', { category: errorCategory(error) });
    return null;
  }
}

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

export function checkLinkText(text: string): string {
  return text.replace(EXTERNAL_LINK, (raw) => {
    const { link, suffix } = splitLink(raw);
    return (safeUrl(link.startsWith('//') ? `https:${link}` : link) === null ? '' : link) + suffix;
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
    if (field === 'source' && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value.trim())) {
      return cleanSite(value) ?? '';
    }
    return checkLinkText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cleanData(entry, field));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cleanData(entry, key.toLowerCase())]));
  }
  return value;
}

export function checkLinkData<T>(value: T): T {
  return cleanData(value, '') as T;
}

export function checkSourceLinks<T extends { kind: string; label: string; ref?: string | null }>(source: T): T {
  const cleaned = checkLinkData(source);
  if (source.kind === 'blocked_site') {
    cleaned.label = cleanSite(source.label) ?? '无效站点';
    if (source.ref?.startsWith('blocked:')) {
      cleaned.ref = `blocked:${cleanSite(source.ref.slice('blocked:'.length)) ?? 'invalid'}`;
    }
  }
  return cleaned;
}
