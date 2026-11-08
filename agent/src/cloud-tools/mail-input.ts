// 抓回来的一封（FetchedMail）→ 站内信的一行：收信时新建（mailInput），mail.refetch 原地补（mailRefill）。两处同一套规矩：
// 标题、名字、地址的长度上限，正文纯文字给搜索和脑，HTML 清洗后存（mail-sanitize.ts），原信和内嵌图落盘（mail-files.ts）。

import {
  INBOX_ATTACHMENTS_MAX,
  INBOX_BODY_MAX_CHARS,
  INBOX_HTML_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
  type InboxMailPart,
  type InboxMessage,
  type InboxMessageInput,
  type InboxMessageRefill,
} from '../../shared/state.ts';
import type { MailFiles } from './mail-files.ts';
import { htmlToText } from './mail-html-text.ts';
import { sanitizeMailHtml } from './mail-sanitize.ts';
import { ownNoticeTitle } from './own-notice.ts';
import type { FetchedMail } from './transports.ts';

export const EMPTY_BODY = '（这封邮件没有可显示的文字）';
// 内嵌图：单张上限 2 MiB（显示时整张换成 data: 放进页面，再大页面就沉了），一封最多 40 张（营销信一般十几张）。
const INLINE_PART_MAX_BYTES = 2 * 1024 * 1024;
const INLINE_PARTS_MAX = 40;
const NAME_MAX_CHARS = 100;
const ADDRESS_MAX_CHARS = 300;
const PART_NAME_MAX_CHARS = 200;
const PART_TYPE_MAX_CHARS = 100;
const CONTENT_ID_MAX_CHARS = 300;

export function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\r\n?/g, '\n').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('');
}

function isoOr(value: string | null, fallback: string): string {
  const at = value === null ? Number.NaN : Date.parse(value);
  return Number.isNaN(at) ? fallback : new Date(at).toISOString();
}

/** 清洗后的 HTML；没有、太大、清洗完什么都不剩的是 null（照纯文字显示）。 */
export function cleanHtml(html: string | null | undefined): string | null {
  if (html === null || html === undefined || html.trim() === '') {
    return null;
  }
  const clean = sanitizeMailHtml(html);
  if (clean.length > INBOX_HTML_MAX_CHARS) {
    return null;
  }
  return htmlToText(clean) === '' && !/<img\b/i.test(clean) ? null : clean;
}

function attachmentNames(mail: FetchedMail): string[] {
  return mail.attachments.map((name) => clip(name, PART_NAME_MAX_CHARS)).filter((name) => name !== '')
    .slice(0, INBOX_ATTACHMENTS_MAX);
}

function emailTitle(mail: FetchedMail, body: string): string {
  return clip(mail.subject, INBOX_TITLE_MAX_CHARS) || clip(body.split('\n')[0] ?? '', 80) || '（没有标题）';
}

export interface MailLocation {
  uidValidity: number;
  mailbox: string;
}

/** 收信新建的一行（不含落盘的那几列，见 storeMailFiles）。 */
export function mailInput(mail: FetchedMail, location: MailLocation, at: string): InboxMessageInput {
  const body = clip(mail.text, INBOX_BODY_MAX_CHARS);
  const notice = ownNoticeTitle(mail);
  const sender = notice === null
    ? {
      source: 'email' as const,
      fromAddress: clip(mail.fromAddress, 200) || '邮件',
      fromName: mail.fromName === null ? null : clip(mail.fromName, NAME_MAX_CHARS) || null,
      title: emailTitle(mail, body),
    }
    : { source: 'plasticine' as const, fromAddress: 'plasticine', fromName: null,
      title: clip(notice, INBOX_TITLE_MAX_CHARS) || '（没有标题）' };
  return {
    ...sender,
    body: body === '' ? EMPTY_BODY : body,
    receivedAt: isoOr(mail.date, at),
    attachments: attachmentNames(mail),
    messageId: clip(mail.messageId ?? `uid-${location.uidValidity}-${mail.uid}`, 300),
    toAddress: mail.toAddress === null ? null : clip(mail.toAddress, ADDRESS_MAX_CHARS),
    bodyHtml: cleanHtml(mail.html),
    imapUid: mail.uid,
    uidValidity: location.uidValidity,
    mailbox: location.mailbox,
    mimeAt: mail.mime === true ? at : null,
  };
}

export interface StoredFiles {
  rawPath: string | null;
  rawSha256: string | null;
  parts: Array<Omit<InboxMailPart, 'id' | 'createdAt'>>;
}

/** 原信和内嵌图落盘（没有 MailFiles 的装配只存库里的列）。 */
export function storeMailFiles(files: MailFiles | undefined, id: string, mail: FetchedMail): StoredFiles {
  if (files === undefined) {
    return { rawPath: null, rawSha256: null, parts: [] };
  }
  const raw = mail.raw === null || mail.raw === undefined ? null : files.writeRaw(id, mail.raw);
  const inline = (mail.inline ?? []).filter((part) => part.data.length <= INLINE_PART_MAX_BYTES)
    .slice(0, INLINE_PARTS_MAX);
  const parts = inline.map((part, index) => ({
    messageId: id,
    contentId: clip(part.contentId, CONTENT_ID_MAX_CHARS),
    filename: part.filename === null ? null : clip(part.filename, PART_NAME_MAX_CHARS) || null,
    type: clip(part.type, PART_TYPE_MAX_CHARS),
    size: part.data.length,
    path: files.writePart(id, index, part.data),
  })).filter((part) => part.contentId !== '' && part.type !== '');
  return { rawPath: raw?.rawPath ?? null, rawSha256: raw?.rawSha256 ?? null, parts };
}

/** mail.refetch 抓回整封以后原地补的字段；新解析出空的地方留着原来的（旧文字、旧附件名）。 */
export function mailRefill(mail: FetchedMail, current: InboxMessage, location: MailLocation, at: string,
  stored: StoredFiles): InboxMessageRefill {
  const body = clip(mail.text, INBOX_BODY_MAX_CHARS);
  const attachments = attachmentNames(mail);
  return {
    title: clip(mail.subject, INBOX_TITLE_MAX_CHARS) || current.title,
    fromName: mail.fromName === null ? current.fromName : clip(mail.fromName, NAME_MAX_CHARS) || current.fromName,
    toAddress: mail.toAddress === null ? current.toAddress : clip(mail.toAddress, ADDRESS_MAX_CHARS),
    body: body === '' ? current.body : body,
    attachments: attachments.length === 0 ? current.attachments : attachments,
    bodyHtml: cleanHtml(mail.html),
    rawPath: stored.rawPath,
    rawSha256: stored.rawSha256,
    imapUid: mail.uid,
    uidValidity: location.uidValidity,
    mailbox: location.mailbox,
    mimeAt: at,
  };
}
