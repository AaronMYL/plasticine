// 明文 HTTP 请求头的最小读法：:80 上只要看请求行的路径和 Host 就能分路（中继）或回 ACME 验证（实例），不需要完整的
// HTTP 解析器。读到空行为止；读出来的字节原样留着，转给别处时一个字节不改。

/** 请求头最多读这么多：ACME 验证请求几百字节，浏览器带 cookie 也就几 KB。 */
export const REQUEST_HEAD_MAX_BYTES = 16 * 1024;
export const ACME_CHALLENGE_PREFIX = '/.well-known/acme-challenge/';

export type RequestHead =
  | { state: 'more' }
  | { state: 'head'; method: string; path: string; host: string | null }
  | { state: 'bad' };

const HEAD_END = '\r\n\r\n';

export function readRequestHead(buffer: Buffer): RequestHead {
  const end = buffer.indexOf(HEAD_END);
  if (end < 0) {
    return buffer.length > REQUEST_HEAD_MAX_BYTES ? { state: 'bad' } : { state: 'more' };
  }
  const lines = buffer.subarray(0, end).toString('latin1').split('\r\n');
  const request = /^([A-Z]+) (\S+) HTTP\/1\.[01]$/.exec(lines[0] ?? '');
  if (request?.[1] === undefined || request[2] === undefined) {
    return { state: 'bad' };
  }
  let host: string | null = null;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon > 0 && line.slice(0, colon).trim().toLowerCase() === 'host') {
      host = line.slice(colon + 1).trim();
    }
  }
  return { state: 'head', method: request[1], path: request[2], host };
}

/** ACME HTTP-01 的 token（路径不是验证路径时是 null）。 */
export function challengeToken(path: string): string | null {
  if (!path.startsWith(ACME_CHALLENGE_PREFIX)) {
    return null;
  }
  const token = path.slice(ACME_CHALLENGE_PREFIX.length);
  return /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  404: 'Not Found',
  502: 'Bad Gateway',
};

/** 一个完整的、回完就关的明文回答。 */
export function plainResponse(status: number, body: string): Buffer {
  const content = Buffer.from(body, 'utf8');
  return Buffer.concat([Buffer.from(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n`
    + `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${content.length}\r\nConnection: close\r\n\r\n`),
  content]);
}
