// 压缩（2026-11-12《首次使用解耦》，Aaron 同意）：中继只转加密后的字节，压不了，只能在本体里压。
// - 接口的 JSON：1 KB 以上当场压（浏览器说收 br 就用 br 快档，否则 gzip）；登录、账号、模型登录这类带凭据的不压，
//   避开靠压缩后长度反推内容的攻击（BREACH）。事件流不走这里，一条一条原样送出。
// - 界面文件：打包时先压好（client/build-compress.ts 写的 .br / .gz），按请求头挑一份发；没有压好的就发原样。
// 只用 Node 自带的 zlib。

import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

export type Encoding = 'br' | 'gzip';

/** 小于这个不压：省下的字节还不够压缩头和 CPU。 */
export const MIN_COMPRESS_BYTES = 1024;

/** Accept-Encoding 里这种编码收不收（`;q=0` 算不收）。 */
function accepts(header: string, name: string): boolean {
  return header.split(',').some((part) => {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    if (token !== name) return false;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}

/** 按请求头挑编码：先 br 再 gzip，都不收就是 null。 */
export function pickEncoding(header: string | string[] | undefined): Encoding | null {
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  if (accepts(value, 'br')) return 'br';
  if (accepts(value, 'gzip')) return 'gzip';
  return null;
}

const SENSITIVE_PREFIXES = ['/v2/session', '/v2/account', '/v2/auth'];

/** 回应里可能带凭据或登录链接的接口：不压。 */
export function sensitivePath(pathname: string): boolean {
  return SENSITIVE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    || /\/login(\/|$)/.test(pathname) || pathname.includes('/oauth');
}

/** 当场压一段文字；不值得压或不收就回 null。 */
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
