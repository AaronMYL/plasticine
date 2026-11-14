// 站内信并进联系人（第 113 条，规格第 10 节）：邮件按发件地址一个联系人（mail:<地址>），点开看来往（原信 + 我的回复），
// 输入框发 = 现有站内信回复（回这个地址最近的一封，开发期干跑只记不发）；巡查、反馈、Cyber Hunter、采访各一个
// 系统联系人（system:<来源>），只读。Plasticine 自己的通知信不进联系人（第 2 批：进常驻项目 Plasticine 的后台，
// 设置 · 通知记录照旧）；判断和后台共用 shared/plasticine-notice.ts。

import {
  CONTACT_MESSAGES_PAGE,
  type ContactDetail,
  type ContactMessageView,
  type ContactMessagesResponse,
  type ContactRow,
  type ContactThreadItem,
} from '../../shared/api/index.ts';
import { isPlasticineNotice } from '../../shared/plasticine-notice.ts';
import type { InboxMessage, InboxReply, InboxSource } from '../../shared/state.ts';
import type { InboxDesk } from '../daily/index.ts';
import type { StateService } from '../state/index.ts';
import { ApiError } from './api-error.ts';

export const MAIL_CONTACT_PREFIX = 'mail:';
export const SYSTEM_CONTACT_PREFIX = 'system:';

type SystemSource = Exclude<InboxSource, 'email' | 'plasticine'>;
export const SYSTEM_CONTACT_NAMES: Readonly<Record<SystemSource, string>> = {
  patrol: '巡查',
  feedback: '反馈',
  'cyber-hunter': 'Cyber Hunter',
  interview: '采访',
};
const SYSTEM_SOURCES: readonly SystemSource[] = ['patrol', 'feedback', 'cyber-hunter', 'interview'];
// 标已读一次翻这么多封。
const READ_PAGE = 200;

export type InboxContact = { kind: 'mail'; address: string } | { kind: 'system'; source: SystemSource };

function isSystemSource(value: string): value is SystemSource {
  return (SYSTEM_SOURCES as readonly string[]).includes(value);
}

/** mail:<地址> / system:<来源>；别的 id 是网络上的人（null）。 */
export function parseInboxContact(id: string): InboxContact | null {
  if (id.startsWith(MAIL_CONTACT_PREFIX)) {
    const address = id.slice(MAIL_CONTACT_PREFIX.length).trim().toLowerCase();
    return address === '' ? null : { kind: 'mail', address };
  }
  if (id.startsWith(SYSTEM_CONTACT_PREFIX)) {
    const source = id.slice(SYSTEM_CONTACT_PREFIX.length);
    return isSystemSource(source) ? { kind: 'system', source } : null;
  }
  return null;
}

export function inboxContactId(message: Pick<InboxMessage, 'source' | 'fromAddress'>): string | null {
  if (isPlasticineNotice(message)) {
    return null;
  }
  if (message.source === 'email') {
    return `${MAIL_CONTACT_PREFIX}${message.fromAddress.trim().toLowerCase()}`;
  }
  return isSystemSource(message.source) ? `${SYSTEM_CONTACT_PREFIX}${message.source}` : null;
}

function filterOf(contact: InboxContact): { address: string } | { source: InboxSource } {
  return contact.kind === 'mail' ? { address: contact.address } : { source: contact.source };
}

function inboxText(message: InboxMessage): string {
  const body = message.body.trim();
  return body === '' || body === message.title ? message.title : `${message.title}\n\n${body}`;
}

/**
 * 一封来信。邮件（2026-11-04 用户定：点开是整宽阅读区，不进气泡）标题、发件人和正文分开给，text 只是纯文字正文；
 * 系统来源（巡查、反馈…）照旧是一条消息。
 */
export function inboxMessageItem(message: InboxMessage): ContactMessageView {
  const base = { id: message.id, author: 'them' as const, at: message.receivedAt, status: 'sent' as const,
    toAi: false, exchangeId: null, taskId: null };
  if (message.source !== 'email') {
    return { ...base, text: inboxText(message) };
  }
  return { ...base, text: message.body.trim(), mail: { subject: message.title, fromName: message.fromName,
    fromAddress: message.fromAddress, html: message.bodyHtml !== null, attachments: message.attachments } };
}

/** 回复的几种状态并成聊天里的三种；干跑记下的另外标一下，不说成发出去了。 */
function replyStatus(reply: InboxReply): ContactMessageView['status'] {
  if (reply.status === 'failed') {
    return 'failed';
  }
  return reply.status === 'sending' || reply.status === 'unknown' ? 'sending' : 'sent';
}

export function inboxReplyItem(reply: InboxReply): ContactMessageView {
  const status = replyStatus(reply);
  return { id: reply.id, author: 'me', text: reply.text, at: reply.sentAt ?? reply.createdAt, status, toAi: false,
    exchangeId: null, taskId: null, ...(reply.status === 'dry_run' ? { dryRun: true } : {}) };
}

function latestOf(state: StateService, contact: InboxContact): { message: InboxMessage | undefined;
  reply: InboxReply | undefined } {
  const message = state.inboxMessages.thread(filterOf(contact), undefined, 1)[0];
  const reply = message === undefined ? undefined : state.inboxReplies.forMessage(message.id).at(-1);
  return { message, reply };
}

function inboxRow(state: StateService, contact: InboxContact, unread: number): ContactRow | null {
  const { message, reply } = latestOf(state, contact);
  if (message === undefined) {
    return null;
  }
  const replyItem = reply === undefined ? undefined : inboxReplyItem(reply);
  const last = replyItem !== undefined && replyItem.at > message.receivedAt
    ? { text: replyItem.text, at: replyItem.at, author: 'me' as const }
    : { text: message.title, at: message.receivedAt, author: 'them' as const };
  const mail = contact.kind === 'mail';
  return {
    id: mail ? `${MAIL_CONTACT_PREFIX}${contact.address}` : `${SYSTEM_CONTACT_PREFIX}${contact.source}`,
    kind: mail ? 'mail' : 'system',
    name: mail ? message.fromName ?? contact.address : SYSTEM_CONTACT_NAMES[contact.source],
    handle: null,
    address: mail ? contact.address : contact.source,
    relation: null,
    state: 'active',
    last,
    unread,
    waiting: false,
    canSend: mail,
    version: 1,
  };
}

/** 邮件联系人和系统联系人，各自有信才出现。 */
export function inboxRows(state: StateService): ContactRow[] {
  const mail = state.inboxMessages.emailSenders().map((sender) =>
    inboxRow(state, { kind: 'mail', address: sender.address }, sender.unread));
  const system = state.inboxMessages.sourceSummaries().flatMap((summary) =>
    !isPlasticineNotice(summary) && isSystemSource(summary.source)
      ? [inboxRow(state, { kind: 'system', source: summary.source }, summary.unread)] : []);
  return [...mail, ...system].filter((row) => row !== null);
}

export function inboxContactRow(state: StateService, contact: InboxContact): ContactRow | null {
  if (contact.kind === 'mail') {
    const sender = state.inboxMessages.emailSenders().find((entry) => entry.address === contact.address);
    return sender === undefined ? null : inboxRow(state, contact, sender.unread);
  }
  const summary = state.inboxMessages.sourceSummaries().find((entry) => entry.source === contact.source);
  return summary === undefined ? null : inboxRow(state, contact, summary.unread);
}

/** 一页来往：原信和它们的回复按时间排，旧的在前。 */
export function inboxThread(state: StateService, contact: InboxContact, before: string | undefined):
  ContactMessagesResponse {
  const messages = state.inboxMessages.thread(filterOf(contact), before, CONTACT_MESSAGES_PAGE);
  const views = messages.flatMap((message) => [inboxMessageItem(message),
    ...state.inboxReplies.forMessage(message.id).map(inboxReplyItem)]);
  views.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const oldest = messages.at(-1);
  const hasMore = oldest !== undefined
    && state.inboxMessages.thread(filterOf(contact), oldest.receivedAt, 1).length > 0;
  return { items: views.map((message): ContactThreadItem => ({ type: 'message', message })), hasMore };
}

export function inboxDetail(row: ContactRow): ContactDetail {
  return { contact: row, tierCap: null, deliveries: [], said: [], safetyCode: null, safetyChanged: false };
}

/** 输入框发 = 回这个地址最近的一封（站内信回复，干跑只记不发）；系统来源不能发。 */
export async function replyToInboxContact(inbox: InboxDesk, state: StateService, contact: InboxContact,
  input: { text: string; requestId: string; deviceId: string }): Promise<ContactMessageView> {
  if (contact.kind === 'system') {
    throw new ApiError(409, 'conflict', '这是只读的来源，不能回。', { next: '要说什么，在对话里跟 Plasticine 说。' });
  }
  const latest = state.inboxMessages.thread({ address: contact.address }, undefined, 1)[0];
  if (latest === undefined) {
    throw new ApiError(404, 'not_found', '没有这个邮件联系人的来信。', { next: '刷新联系人列表后再试。' });
  }
  const reply = await inbox.reply(latest.id, input.text, input.requestId, input.deviceId);
  return inboxReplyItem(reply);
}

/** 标已读：`upTo` 以前（含）的来信。返回标了几封。 */
export function readInboxContact(inbox: InboxDesk, state: StateService, contact: InboxContact, upTo: string,
  afterCommit: (action: () => void) => void): number {
  let marked = 0;
  let before: string | undefined;
  for (;;) {
    const page = state.inboxMessages.thread(filterOf(contact), before, READ_PAGE);
    for (const message of page.filter((entry) => entry.readAt === null && entry.receivedAt <= upTo)) {
      inbox.setFlags(message.id, message.version, { read: true }, afterCommit);
      marked += 1;
    }
    const oldest = page.at(-1);
    if (page.length < READ_PAGE || oldest === undefined) {
      return marked;
    }
    before = oldest.receivedAt;
  }
}
