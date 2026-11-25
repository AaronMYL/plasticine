import PostalMime, { type Address, type Attachment, type Email } from 'postal-mime';
import { cleanMailText, htmlToText } from './mail-html-text.ts';
import { decodeHeaderWords } from './mail-words.ts';

export interface MailInlinePart {
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
  text: string;
  html: string | null;
  attachments: string[];
  inline: MailInlinePart[];
}

const MAX_PARTS = 2_000;
const MAX_NESTING = 50;
const HTML_START = new RegExp('^\\s*(?:<!doctype\\s+html|<html[\\s>]|<head[\\s>]|<body[\\s>]|<table[\\s>]'
  + '|<div[\\s>]|<style[\\s>]|<meta[\\s>])', 'i');
const HTML_CLOSE = /<\/(?:html|body|table|div|p|style)\s*>/i;
const CALENDAR_TYPE = 'text/calendar';
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
