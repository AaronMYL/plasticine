// node:http plumbing: reading a bounded JSON body, writing JSON or bytes, cookies. No routing, no business here.

import { createHash } from 'node:crypto';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { cleanOutboundJson, type PreserveOutboundField } from '../outbound.ts';
import { ApiError } from './api-error.ts';
import { compressText, type Encoding } from './compression.ts';
import { MAX_BODY_BYTES } from './config.ts';

export const JSON_TYPE = 'application/json; charset=utf-8';

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {},
  preserve?: PreserveOutboundField,
  /** 浏览器收的压缩编码（server.ts 按请求头挑，带凭据的接口给 null）；不给就不压。 */
  encoding: Encoding | null = null,
): void {
  if (status === 204) {
    res.writeHead(status, { 'cache-control': 'no-store', ...headers });
    res.end();
    return;
  }
  const text = JSON.stringify(cleanOutboundJson(body, preserve));
  const packed = compressText(text, encoding);
  if (packed !== null) {
    res.writeHead(status, {
      'content-type': JSON_TYPE,
      'content-encoding': packed.encoding,
      'content-length': packed.data.length,
      'cache-control': 'no-store',
      vary: 'accept-encoding',
      ...headers,
    });
    res.end(packed.data);
    return;
  }
  res.writeHead(status, {
    'content-type': JSON_TYPE,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export interface BytesOptions {
  noStore?: boolean;
  /** Files of the files page change under the same path: not cached, and offered as a download with this name. */
  download?: string;
}

export function sendBytes(res: ServerResponse, status: number, data: Buffer, type: string, options: BytesOptions = {}) {
  const headers: OutgoingHttpHeaders = {
    'content-type': type,
    'content-length': data.length,
    // A picture's name never changes its content (the old notebook wrote each name once).
    'cache-control': options.download === undefined && !options.noStore ? 'private, max-age=86400' : 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (options.download !== undefined) {
    // RFC 6266 / 5987: the name in UTF-8, percent-encoded, so no header can be broken by the file's name.
    headers['content-disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(options.download)}`;
    // Never render a downloaded file as a page of this site.
    headers['content-security-policy'] = "default-src 'none'; sandbox";
  }
  res.writeHead(status, headers);
  res.end(data);
}

/** The JSON body of a request; a body is required to be JSON so a cross-site form post cannot reach a handler. */
export async function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return parseJson(await readRawBody(req, maxBytes));
}

/**
 * The JSON body and the SHA-256 (base64url) of its exact bytes: idempotent confirmations bind the requestId to
 * what was sent, not a re-serialisation of what was parsed.
 */
export async function readJsonBodyWithDigest(req: IncomingMessage): Promise<{
  value: unknown; digest: string; bodyText: string;
}> {
  const raw = await readRawBody(req);
  return { value: parseJson(raw), digest: createHash('sha256').update(raw).digest('base64url'),
    bodyText: raw.toString('utf8') };
}

function parseJson(raw: Buffer): unknown {
  const text = raw.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_request', '请求体不是合法的 JSON。请检查格式后重试。');
  }
}

/** The exact bytes of a JSON body (the Cyber Hunter relay verifies its account signatures over them). */
export async function readRawBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<Buffer> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw new ApiError(415, 'invalid_content_type', '请求体要是 JSON（Content-Type: application/json）。');
  }
  return collectBody(req, maxBytes);
}

/**
 * 原样的二进制请求体（附件分块上传，第13批）：要 Content-Type: application/octet-stream（表单发不出这种请求，跨站
 * 的 PUT 也过不了浏览器的预检）。
 */
export async function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/octet-stream\b/i.test(type)) {
    throw new ApiError(415, 'invalid_content_type', '请求体要是原始字节（Content-Type: application/octet-stream）。');
  }
  return collectBody(req, maxBytes);
}

async function collectBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const tooLarge = (): ApiError =>
    new ApiError(413, 'payload_too_large', `请求体超过 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > maxBytes) {
    throw tooLarge();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > maxBytes) {
      throw tooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at <= 0) {
      continue;
    }
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (!cookies.has(name)) {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/**
 * Secure unless the instance is an install package serving plain http on 127.0.0.1 (PLASTICINE_PLAIN_HTTP=1,
 * docs/install-packages.md): WebKit drops Secure cookies set over http even on loopback, so the Mac App could not
 * stay logged in. The service only listens on 127.0.0.1, so the cookie never crosses a network either way.
 */
function secureAttribute(env: Record<string, string | undefined>): string {
  return env['PLASTICINE_PLAIN_HTTP'] === '1' ? '' : ' Secure;';
}

/** HttpOnly + Secure + SameSite=Strict (decision 90 ②, task brief); Caddy serves the site over https. */
export function sessionCookie(name: string, token: string, maxAgeMs: number,
  env: Record<string, string | undefined> = process.env): string {
  const maxAge = Math.floor(maxAgeMs / 1000);
  return `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly;${secureAttribute(env)} SameSite=Strict`;
}

export function clearedCookie(name: string, env: Record<string, string | undefined> = process.env): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly;${secureAttribute(env)} SameSite=Strict`;
}
