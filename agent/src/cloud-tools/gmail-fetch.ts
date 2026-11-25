import { randomUUID } from 'node:crypto';
import { errorCategory, safeLog } from '../util/index.ts';
import { mailParts, type MailPartPlan } from './mail-bodystructure.ts';
import { parseMail, type ParsedMail } from './mail-parse.ts';
import type { ImapResponse } from './mail-protocol.ts';
import { mailProtocolError } from './mail-wire.ts';
import type { FetchedMail } from './transports.ts';

export type ImapCommand = (text: string) => Promise<ImapResponse>;

export const FULL_FETCH_MAX_BYTES = 7 * 1024 * 1024;
const PART_FETCH_MAX_BYTES = 7 * 1024 * 1024;
const PART_IMAGES_MAX = 40;

export async function messageSizes(command: ImapCommand, uids: readonly number[]): Promise<Map<number, number>> {
  const sizes = new Map<number, number>();
  if (uids.length === 0) {
    return sizes;
  }
  const fetched = await command(`UID FETCH ${uids.join(',')} (UID RFC822.SIZE)`);
  for (const line of fetched.lines) {
    const uid = Number(/\bUID (\d+)/.exec(line)?.[1]);
    const size = Number(/\bRFC822\.SIZE (\d+)/.exec(line)?.[1]);
    if (Number.isSafeInteger(uid) && Number.isSafeInteger(size)) {
      sizes.set(uid, size);
    }
  }
  return sizes;
}

function bodylessHeader(header: Buffer): string {
  const text = header.toString('latin1').replace(/\r?\n\r?\n[\s\S]*$/, '');
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) {
        kept.push(line);
      }
      continue;
    }
    skipping = /^content-(type|transfer-encoding)\s*:/i.test(line);
    if (!skipping) {
      kept.push(line);
    }
  }
  return kept.join('\r\n');
}

async function fetchSection(command: ImapCommand, uid: number, path: string): Promise<{ mime: Buffer; body: Buffer }> {
  const response = await command(`UID FETCH ${uid} (BODY.PEEK[${path}.MIME] BODY.PEEK[${path}])`);
  const mime = response.literals.find((entry) => entry.section === `${path}.MIME`)?.data;
  const body = response.literals.find((entry) => entry.section === path)?.data;
  if (mime === undefined || body === undefined) {
    throw mailProtocolError();
  }
  return { mime, body };
}

async function partialMessage(command: ImapCommand, uid: number): Promise<Buffer> {
  const response = await command(`UID FETCH ${uid} (BODY.PEEK[HEADER] BODYSTRUCTURE)`);
  const header = response.literals.find((entry) => entry.section === 'HEADER')?.data;
  if (header === undefined) {
    throw mailProtocolError();
  }
  const plan = mailParts(response.lines.join(' ')).filter((part) => part.size <= PART_FETCH_MAX_BYTES);
  const texts = plan.filter((part) => part.kind !== 'image');
  const images = plan.filter((part) => part.kind === 'image').slice(0, PART_IMAGES_MAX);
  const head = bodylessHeader(header);
  if (texts.length === 1 && texts[0]?.path === 'TEXT') {
    const body = await command(`UID FETCH ${uid} (BODY.PEEK[TEXT])`);
    const text = body.literals.find((entry) => entry.section === 'TEXT')?.data ?? Buffer.alloc(0);
    return Buffer.concat([header, text]);
  }
  const outer = `plasticine-related-${randomUUID()}`;
  const inner = `plasticine-alternative-${randomUUID()}`;
  const chunks: Buffer[] = [Buffer.from(`${head}\r\nContent-Type: multipart/related; boundary="${outer}"\r\n\r\n`
    + `--${outer}\r\nContent-Type: multipart/alternative; boundary="${inner}"\r\n\r\n`)];
  const add = async (part: MailPartPlan, boundary: string): Promise<void> => {
    const section = await fetchSection(command, uid, part.path);
    chunks.push(Buffer.from(`--${boundary}\r\n`), section.mime, section.body, Buffer.from('\r\n'));
  };
  for (const part of texts) {
    await add(part, inner);
  }
  chunks.push(Buffer.from(`--${inner}--\r\n`));
  for (const part of images) {
    await add(part, outer);
  }
  chunks.push(Buffer.from(`--${outer}--\r\n`));
  return Buffer.concat(chunks);
}

function fetched(uid: number, parsed: ParsedMail, raw: Buffer | null): FetchedMail {
  const { inline, html, ...fields } = parsed;
  return { uid, ...fields, html, inline, raw, mime: true };
}

function unreadable(uid: number, raw: Buffer | null, error: unknown): FetchedMail {
  safeLog('warn', 'mail_parse_failed', { category: errorCategory(error) });
  return { uid, messageId: null, fromAddress: '', fromName: null, toAddress: null, subject: '', text: '', date: null,
    attachments: [], html: null, inline: [], raw, mime: true };
}

export async function fetchMessage(command: ImapCommand, uid: number, size: number): Promise<FetchedMail> {
  let raw: Buffer | null = null;
  let message: Buffer;
  if (size <= FULL_FETCH_MAX_BYTES) {
    const response = await command(`UID FETCH ${uid} (BODY.PEEK[])`);
    const whole = response.literals.find((entry) => entry.section === '')?.data;
    if (whole === undefined) {
      throw mailProtocolError();
    }
    raw = Buffer.from(whole);
    message = raw;
  } else {
    message = await partialMessage(command, uid);
  }
  try {
    return fetched(uid, await parseMail(message), raw);
  } catch (error) {
    return unreadable(uid, raw, error);
  }
}
