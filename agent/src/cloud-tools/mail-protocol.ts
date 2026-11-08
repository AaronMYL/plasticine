// 纯协议解析：样本可离线回放，错误不包含服务器原文。邮件本身的 MIME 解析在 mail-parse.ts（postal-mime）。
import { MailWire, mailProtocolError } from './mail-wire.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function imapDate(date: Date): string {
  return `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

export function imapQuote(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw mailProtocolError();
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface ImapResponse { lines: string[]; literals: { section: string; data: Buffer }[] }

export async function readImap(wire: MailWire, tag: string): Promise<ImapResponse> {
  const response: ImapResponse = { lines: [], literals: [] };
  let total = 0;
  for (;;) {
    const line = await wire.line();
    total += Buffer.byteLength(line);
    if (total > 8 * 1024 * 1024) { throw mailProtocolError(); }
    if (line.startsWith(`${tag} `)) {
      if (!line.startsWith(`${tag} OK`)) {
        throw mailProtocolError();
      }
      return response;
    }
    response.lines.push(line);
    const literal = /BODY\[([^\]]*)\]\s+\{(\d+)\}$/.exec(line);
    if (literal !== null) {
      response.literals.push({ section: literal[1] ?? '', data: await wire.literal(Number(literal[2])) });
    } else {
      const other = /\{(\d+)\}$/.exec(line);
      if (other !== null) {
        const bytes = await wire.literal(Number(other[1]));
        const quoted = '"' + bytes.toString('utf8').replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
        response.lines[response.lines.length - 1] = line.replace(/\{\d+\}$/, quoted);
        total += bytes.length;
      }
    }
  }
}

export class SmtpRejection extends Error {
  constructor() { super('邮件服务器明确拒收，请检查配置后再试。'); }
}

export async function readSmtp(wire: MailWire, allowed: readonly number[]): Promise<void> {
  let expected: number | null = null;
  for (;;) {
    const match = /^(\d{3})([ -])/.exec(await wire.line());
    const code = Number(match?.[1]);
    if (match === null || (expected !== null && expected !== code)) {
      throw mailProtocolError();
    }
    expected = code;
    if (match[2] === ' ') {
      if (!allowed.includes(code)) {
        if (code >= 400 && code < 600) { throw new SmtpRejection(); }
        throw mailProtocolError();
      }
      return;
    }
  }
}

export function smtpData(address: string, subject: string, text: string, inReplyTo: string | null,
  to: string = address): string {
  if (/[\r\n\0]/.test(subject) || /[\r\n\0]/.test(inReplyTo ?? '') || /[\r\n\0<>]/.test(to)) {
    throw mailProtocolError();
  }
  // 头用 RFC 2047，正文 UTF-8；每行开头的点加倍，正文永远不能提前结束 DATA。
  const parts = [
    `From: <${address}>`, `To: <${to}>`, `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit',
    ...(inReplyTo === null ? [] : [`In-Reply-To: ${inReplyTo}`]), '', text,
  ];
  return parts.join('\r\n').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n';
}
