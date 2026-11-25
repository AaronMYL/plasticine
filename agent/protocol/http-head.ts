// SPDX-License-Identifier: Apache-2.0

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

export function plainResponse(status: number, body: string): Buffer {
  const content = Buffer.from(body, 'utf8');
  return Buffer.concat([Buffer.from(`HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? 'Error'}\r\n`
    + `Content-Type: text/plain; charset=utf-8\r\nContent-Length: ${content.length}\r\nConnection: close\r\n\r\n`),
  content]);
}
