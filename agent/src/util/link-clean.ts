import { EXTERNAL_LINK, splitLink } from './link-text.ts';

const CREDENTIAL_WORDS = [
  'token', 'secret', 'key', 'sig', 'auth', 'pass', 'pwd', 'session', 'sid', 'cred', 'code', 'bearer', 'jwt', 'otp',
];
const PUBLIC_WORDS = new Set(['keyword', 'monkey', 'passage', 'author']);
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
  for (let layer = 1; layer <= MAX_DECODE_LAYERS; layer += 1) {
    const normalized = value.normalize('NFKC').trim();
    if (URL_SHAPE.test(normalized) || JWT_SHAPE.test(normalized)) {
      return true;
    }
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

export function cleanUrlQuery(query: string): string {
  return query.split('&').filter((pair) => {
    const entry = new URLSearchParams(pair).entries().next().value;
    return entry === undefined || (!isCredentialParam(entry[0]) && !unsafeValue(entry[1]));
  }).join('&');
}

function cleanFragment(fragment: string): string {
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
  return text.includes('//') ? text.replace(EXTERNAL_LINK, cleanMatchedLink) : text;
}
