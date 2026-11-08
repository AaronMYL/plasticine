// 一封原信（RFC 822 的字节）→ 站内信要存的各样东西：标题、发件人、收件人、给搜索和脑用的纯文字、原样的 HTML、内嵌图、
// 附件名。
//
// MIME 解析用 postal-mime，不自己写：旧版自己写的解析只取一个文字分段、HTML 靠正则剥，格式、排版、图片全丢；MIME 的边角
// （嵌套 multipart、QP / base64、RFC 2047 / 2231 的名字、各种字符集、message/rfc822、畸形边界）再手写一遍既长又容易错。
// postal-mime 是 Nodemailer 作者维护的现成解析器，零依赖、MIT-0，给出 html、text 和带 Content-ID 的分段。
// 标题、发件人名字、收件人另用 mail-words.ts 解：一个汉字拆在两个带补位的 B 编码词里时，postal-mime 解出 �。

import PostalMime, { type Address, type Attachment, type Email } from 'postal-mime';
import { cleanMailText, htmlToText } from './mail-html-text.ts';
import { decodeHeaderWords } from './mail-words.ts';

export interface MailInlinePart {
  /** 去掉尖括号的 Content-ID（HTML 里写成 cid:<这个>）。 */
  contentId: string;
  filename: string | null;
  type: string;
  data: Buffer;
}

export interface ParsedMail {
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string | null;
  subject: string;
  date: string | null;
  /** 给搜索、脑、列表预览的纯文字：有纯文字分段用它，否则由 HTML 转。 */
  text: string;
  /** 信里原样的 HTML（还没清洗）；只有纯文字的信是 null。 */
  html: string | null;
  attachments: string[];
  inline: MailInlinePart[];
}

// 一封信最多这么多个 MIME 分段、嵌套这么多层（postal-mime 默认一万个、256 层）：正常的信几十个，再多是畸形或炸弹。
const MAX_PARTS = 2_000;
const MAX_NESTING = 50;
// 纯文字分段里装着整份 HTML 的信（线上 Guardian、Bolt）：开头就是这些标签，里面还有成对的结束标签。
const HTML_START = new RegExp('^\\s*(?:<!doctype\\s+html|<html[\\s>]|<head[\\s>]|<body[\\s>]|<table[\\s>]'
  + '|<div[\\s>]|<style[\\s>]|<meta[\\s>])', 'i');
const HTML_CLOSE = /<\/(?:html|body|table|div|p|style)\s*>/i;
const CALENDAR_TYPE = 'text/calendar';
// 会议邀请的日历分段常常没有文件名；记成 invite.ics，事与来源的会议邀请规则（matters/triggers.ts）认后缀。
const CALENDAR_NAME = 'invite.ics';

function header(email: Email, key: string): string | null {
  const value = email.headers.find((entry) => entry.key === key)?.value.trim();
  return value === undefined || value === '' ? null : value;
}

function firstMailbox(address: Address | undefined): { address: string; name: string } | null {
  if (address === undefined) {
    return null;
  }
  if (address.group === undefined) {
    return { address: address.address, name: address.name };
  }
  const first = address.group[0];
  return first === undefined ? null : { address: first.address, name: first.name };
}

/** postal-mime 解出 � 的名字，从原头重新解（只取尖括号前那段）。 */
function displayName(raw: string | null, parsed: string): string | null {
  let name = parsed;
  if (name.includes('�') && raw !== null) {
    const at = raw.indexOf('<');
    name = decodeHeaderWords(at < 0 ? raw : raw.slice(0, at));
  }
  const clean = name.trim().replace(/^"(.*)"$/, '$1').trim();
  return clean === '' ? null : clean;
}

function looksLikeHtml(text: string): boolean {
  return HTML_START.test(text) && HTML_CLOSE.test(text);
}

function bytesOf(content: Attachment['content']): Buffer {
  if (typeof content === 'string') {
    return Buffer.from(content, 'base64');
  }
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  return Buffer.from(content);
}

function splitParts(email: Email): { inline: MailInlinePart[]; attachments: string[] } {
  const inline: MailInlinePart[] = [];
  const attachments: string[] = [];
  for (const part of email.attachments) {
    const contentId = part.contentId?.trim().replace(/^<(.*)>$/, '$1').trim() ?? '';
    const image = part.mimeType.startsWith('image/');
    if (image && contentId !== '' && (part.related === true || part.disposition !== 'attachment')) {
      inline.push({ contentId, filename: part.filename, type: part.mimeType, data: bytesOf(part.content) });
      continue;
    }
    const name = part.filename ?? (part.mimeType === CALENDAR_TYPE ? CALENDAR_NAME : null);
    if (name !== null && name.trim() !== '' && !attachments.includes(name.trim())) {
      attachments.push(name.trim());
    }
  }
  return { inline, attachments };
}

function bodies(email: Email): { text: string; html: string | null } {
  let html = email.html ?? null;
  let plain = email.text ?? null;
  if (plain !== null && looksLikeHtml(plain)) {
    html ??= plain;
    plain = null;
  }
  if (html !== null && html.trim() === '') {
    html = null;
  }
  if (plain !== null && plain.trim() !== '') {
    return { text: cleanMailText(plain), html };
  }
  return { text: html === null ? '' : htmlToText(html), html };
}

/** 解析一封原信；MIME 畸形到 postal-mime 也读不了时抛它的错（调用方按「这一封没解析成」处理）。 */
export async function parseMail(raw: Buffer): Promise<ParsedMail> {
  const email = await PostalMime.parse(raw, {
    attachmentEncoding: 'arraybuffer',
    maxPartCount: MAX_PARTS,
    maxNestingDepth: MAX_NESTING,
  });
  const from = firstMailbox(email.from);
  const to = header(email, 'to');
  const { inline, attachments } = splitParts(email);
  const messageId = email.messageId?.trim() ?? header(email, 'message-id');
  return {
    messageId: messageId === undefined || messageId === null || messageId === '' ? null : messageId,
    fromAddress: from?.address.trim() ?? '',
    fromName: from === null ? null : displayName(header(email, 'from'), from.name),
    toAddress: to === null ? null : decodeHeaderWords(to).replace(/\s+/g, ' ').trim() || null,
    subject: decodeHeaderWords(header(email, 'subject') ?? '').replace(/\s+/g, ' ').trim(),
    date: header(email, 'date'),
    ...bodies(email),
    attachments,
    inline,
  };
}
