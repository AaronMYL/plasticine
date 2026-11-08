// 站内信（《UI 方案》第 9 节：铃；十个分类、已读 / 收藏 / 归档、回复）：用户所有邮件和消息的入口。列表带预览不带全文；
// 打开一封才给全文和历史回复。第 113 条起邮件又能回了（站内信并进联系人，用户点发送才发）：回复寄回原发件人，
// 走回执幂等（同一个 requestId 不发第二封），开发期干跑只记不发；其他来源只记站内回复。
// 「结果待核实」照旧，用户可以说发没发出去（settle）。

import type { InboxMessage, InboxMessagePatch, InboxReply, InboxSource } from '../../shared/state.ts';
import { CloudToolError, type MailSender, SEND_TIMEOUT_MS } from '../cloud-tools/index.ts';
import { runExternalOnce, settleExternal } from '../system/index.ts';
import type { InboxBox, StateService } from '../state/index.ts';
import { DailyError } from './errors.ts';

export const INBOX_PAGE_DEFAULT = 50;
export const PREVIEW_MAX_CHARS = 160;
const NO_OUTSIDE_TARGET = '这个来源没有外发的去处，回复只记在站内信里。';
const NOT_CONFIGURED = '邮箱还没连接，这封没有发出去。';
const SEND_FAILED = '邮件没有发出去，可以再发一次。';
const SEND_UNKNOWN = '说不清发没发出去：先看看自己的已发送，再在这里说发没发出去。';
const SUBJECT_PREFIX = 'Re: ';

export function replyActionId(requestId: string): string {
  return `inbox-reply:${requestId}`;
}

export function previewOf(body: string): string {
  return Array.from(body.replace(/\s+/g, ' ').trim()).slice(0, PREVIEW_MAX_CHARS).join('');
}

export interface InboxFlags {
  read?: boolean;
  starred?: boolean;
  archived?: boolean;
}

export interface InboxSink {
  messageChanged(message: InboxMessage): void;
}

export interface InboxDeskOptions {
  state: StateService;
  mail: MailSender;
  dryRun: boolean;
  now: () => Date;
}

export class InboxDesk {
  readonly #options: InboxDeskOptions;
  #sink: InboxSink | null = null;

  constructor(options: InboxDeskOptions) {
    this.#options = options;
  }

  attach(sink: InboxSink): void {
    this.#sink = sink;
  }

  /** A new message arrived (the mail sync, a feedback key …): tell the open streams. */
  announce(message: InboxMessage): void {
    this.#sink?.messageChanged(message);
  }

  page(box: InboxBox, query: string | undefined, offset: number, limit: number) {
    const { state } = this.#options;
    const filter = query === undefined ? { box } : { box, query };
    return {
      messages: state.inboxMessages.page(filter, { limit, offset }),
      total: state.inboxMessages.count(filter),
    };
  }

  unread(): { total: number; bySource: Record<InboxSource, number> } {
    const bySource = this.#options.state.inboxMessages.unreadBySource();
    return { total: Object.values(bySource).reduce((sum, n) => sum + n, 0), bySource };
  }

  open(id: string): { message: InboxMessage; replies: InboxReply[] } {
    const { state } = this.#options;
    const message = state.inboxMessages.get(id);
    if (message === undefined) {
      throw new DailyError('not_found', '没有这封站内信。');
    }
    return { message, replies: state.inboxReplies.forMessage(id) };
  }

  setFlags(id: string, version: number, flags: InboxFlags, afterCommit?: (action: () => void) => void): InboxMessage {
    const { state, now } = this.#options;
    const at = now().toISOString();
    const current = this.open(id).message;
    const patch: InboxMessagePatch = {};
    if (flags.read !== undefined) {
      patch.readAt = flags.read ? (current.readAt ?? at) : null;
    }
    if (flags.starred !== undefined) {
      patch.starredAt = flags.starred ? (current.starredAt ?? at) : null;
    }
    if (flags.archived !== undefined) {
      patch.archivedAt = flags.archived ? (current.archivedAt ?? at) : null;
    }
    const message = state.inboxMessages.update(id, version, patch);
    const tell = (): void => this.#sink?.messageChanged(message);
    if (afterCommit === undefined) {
      tell();
    } else {
      afterCommit(tell);
    }
    return message;
  }

  /** Every unread message of a box marked read; returns them (the box's other messages are untouched). */
  readAll(box: InboxBox, afterCommit: (action: () => void) => void): InboxMessage[] {
    const { state, now } = this.#options;
    const at = now().toISOString();
    const changed: InboxMessage[] = [];
    for (;;) {
      const page = state.inboxMessages.page({ box }, { limit: 500 }).filter((message) => message.readAt === null);
      if (page.length === 0) {
        break;
      }
      for (const message of page) {
        changed.push(state.inboxMessages.update(message.id, message.version, { readAt: at }));
      }
    }
    afterCommit(() => {
      for (const message of changed) {
        this.#sink?.messageChanged(message);
      }
    });
    return changed;
  }

  /**
   * Replies to a message. The same requestId again gives back the reply recorded the first time (with the same text;
   * other text under that id is refused) and never sends a second mail.
   */
  async reply(id: string, text: string, requestId: string, deviceId: string): Promise<InboxReply> {
    const { state } = this.#options;
    const actionId = replyActionId(requestId);
    const earlier = state.inboxReplies.byActionId(actionId);
    if (earlier !== undefined) {
      if (earlier.messageId !== id || earlier.text !== text) {
        throw new DailyError('conflict', '这个 requestId 已经用在另一条回复上了，这次没有执行。', 'requestId');
      }
      return this.#refresh(earlier);
    }
    const { message } = this.open(id);
    if (message.source !== 'email') {
      return state.inboxReplies.create({ messageId: id, text, actionId, deviceId,
        status: 'stored', sentAt: null, error: NO_OUTSIDE_TARGET });
    }
    return this.#replyByMail(message, text, actionId, deviceId);
  }

  /** 寄回原发件人：先记一行 sending，再按回执幂等发；干跑只记成 dry_run。 */
  async #replyByMail(message: InboxMessage, text: string, actionId: string, deviceId: string): Promise<InboxReply> {
    const { state, mail, dryRun, now } = this.#options;
    if (!dryRun && !mail.configured()) {
      return state.inboxReplies.create({ messageId: message.id, text, actionId, deviceId, status: 'failed',
        sentAt: null, error: NOT_CONFIGURED });
    }
    let reply = state.inboxReplies.create({ messageId: message.id, text, actionId, deviceId, status: 'sending',
      sentAt: null, error: null });
    const subject = message.title.startsWith(SUBJECT_PREFIX) ? message.title : `${SUBJECT_PREFIX}${message.title}`;
    const outcome = await runExternalOnce(state, { actionId, tool: 'inbox_reply_mail',
      args: { to: message.fromAddress, subject, text }, dryRun },
    (error) => error instanceof CloudToolError && error.code !== 'unknown',
    () => mail.send({ to: message.fromAddress, subject, text, inReplyTo: message.messageId },
      AbortSignal.timeout(SEND_TIMEOUT_MS)), now);
    reply = state.inboxReplies.byId(reply.id) ?? reply;
    switch (outcome.kind) {
      case 'done':
      case 'already_done':
        return state.inboxReplies.update(reply.id, reply.version, { status: 'sent', sentAt: now().toISOString() });
      case 'dry_run':
        return state.inboxReplies.update(reply.id, reply.version, { status: 'dry_run' });
      case 'failed':
        return state.inboxReplies.update(reply.id, reply.version, { status: 'failed',
          error: outcome.error instanceof CloudToolError ? outcome.error.message.slice(0, 300) : SEND_FAILED });
      case 'unknown':
        return state.inboxReplies.update(reply.id, reply.version, { status: 'unknown', error: SEND_UNKNOWN });
      case 'conflict':
        state.inboxReplies.update(reply.id, reply.version, { status: 'failed', error: SEND_FAILED });
        throw new DailyError('conflict', '这个 requestId 已经用在另一封邮件上了，这次没有发。', 'requestId');
    }
  }

  /** You said whether a reply whose result was unknown went out. */
  settleReply(replyId: string, happened: boolean): InboxReply {
    const { state, now } = this.#options;
    const reply = state.inboxReplies.byId(replyId);
    if (reply === undefined) {
      throw new DailyError('not_found', '没有这条回复。');
    }
    const current = this.#refresh(reply);
    if (current.status !== 'unknown') {
      return current;
    }
    settleExternal(state, current.actionId, happened, now);
    const patch = happened
      ? { status: 'sent' as const, sentAt: now().toISOString() }
      : { status: 'failed' as const, error: '你确认这封没有发出去；可以再发一次。' };
    return state.inboxReplies.update(current.id, current.version, patch);
  }

  /** A reply still 「sending」 whose receipt the restart check marked unknown is unknown too. */
  #refresh(reply: InboxReply): InboxReply {
    if (reply.status !== 'sending') {
      return reply;
    }
    const receipt = this.#options.state.receipts.get(reply.actionId);
    if (receipt === undefined || receipt.status === 'issued' || receipt.status === 'unknown') {
      const age = this.#options.now().getTime() - Date.parse(reply.createdAt);
      if (receipt?.status === 'unknown' || age > 2 * SEND_TIMEOUT_MS) {
        return this.#options.state.inboxReplies.update(reply.id, reply.version, { status: 'unknown' });
      }
    }
    return reply;
  }
}
