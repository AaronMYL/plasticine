import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export type Encoding = 'br' | 'gzip';

export const MIN_COMPRESS_BYTES = 1024;

function accepts(header: string, name: string): boolean {
  return header.split(',').some((part) => {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    if (token !== name) return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

export function pickEncoding(header: string | string[] | undefined): Encoding | null {
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  if (accepts(value, 'br')) return 'br';
  if (accepts(value, 'gzip')) return 'gzip';
  return null;
}

const SENSITIVE_PREFIXES = ['/v2/session', '/v2/account', '/v2/auth'];

export function sensitivePath(pathname: string): boolean {
  return SENSITIVE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || /\/login(\/|$)/.test(pathname) || pathname.includes('/oauth');
}

export function compressText(text: string, encoding: Encoding | null): { data: Buffer; encoding: Encoding } | null {
  if (encoding === null) return null;
  const raw = Buffer.from(text);
  if (raw.length < MIN_COMPRESS_BYTES) return null;
  const data = encoding === 'br'
    ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 4,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
    : gzipSync(raw, { level: 6 });
  return { data, encoding };
}
