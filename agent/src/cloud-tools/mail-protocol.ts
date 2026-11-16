// 纯协议解析：样本可离线回放，错误不包含服务器原文。邮件本身的 MIME 解析在 mail-parse.ts（postal-mime）。
import { createHash } from 'node:crypto';
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

export interface SmtpAttachment {
  name: string;
  type: string;
  data: Buffer;
}

export interface SmtpMessage {
  from: string;
  to: readonly string[];
  cc: readonly string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  attachments: readonly SmtpAttachment[];
}

/** 头里的非 ASCII 字用 RFC 2047 的 B 编码。 */
function encodedWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

function base64Lines(data: Buffer): string {
  return data.toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();
}

/** 整封信（DATA 段）：收件人、抄送进头（密送只进 RCPT，不进头）；有附件就是 multipart/mixed，附件按 base64。 */
export function smtpMessage(mail: SmtpMessage): string {
  const addresses = [mail.from, ...mail.to, ...mail.cc];
  if (/[\r\n\0]/.test(mail.subject) || /[\r\n\0]/.test(mail.inReplyTo ?? '')
    || addresses.some((address) => /[\r\n\0<>,]/.test(address))
    || mail.attachments.some((file) => /[\r\n\0"]/.test(file.name) || !/^[\w.+-]+\/[\w.+-]+$/.test(file.type))) {
    throw mailProtocolError();
  }
  const head = [`From: <${mail.from}>`, `To: ${mail.to.map((address) => `<${address}>`).join(', ')}`,
    ...(mail.cc.length === 0 ? [] : [`Cc: ${mail.cc.map((address) => `<${address}>`).join(', ')}`]),
    `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString('base64')}?=`, 'MIME-Version: 1.0',
    ...(mail.inReplyTo === null ? [] : [`In-Reply-To: ${mail.inReplyTo}`])];
  const textPart = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', '', mail.text];
  let body: string[];
  if (mail.attachments.length === 0) {
    body = textPart;
  } else {
    const boundary = `plasticine-${createHash('sha256').update(mail.subject).update(mail.text).digest('hex')
      .slice(0, 24)}`;
    body = [`Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...textPart,
      ...mail.attachments.flatMap((file) => [`--${boundary}`,
        `Content-Type: ${file.type}; name="${encodedWord(file.name)}"`, 'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${encodedWord(file.name)}"`, '', base64Lines(file.data)]),
      `--${boundary}--`];
  }
  // 正文 UTF-8；每行开头的点加倍，正文永远不能提前结束 DATA。
  return [...head, ...body].join('\r\n').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..') + '\r\n.\r\n';
}

