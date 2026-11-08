// 假的站内信和工具组：邮件不接受新回复；其他来源只记站内回复，保留历史的核实入口。
// 工具组的开关经本人会话确认（FakeSigned 调 confirm）。写操作按 requestId 幂等，变了推 inbox.changed / tool_group.changed。

import type { InboxApi, ToolGroupsApi } from '../m5b-client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import {
  INBOX_BOX_LABELS,
  TOOL_GROUPS,
  type InboxListQuery,
  type InboxListResponse,
  type InboxMessageView,
  type InboxReplyView,
  type InboxRowResponse,
  type InboxRowView,
  type InboxUnread,
  type SyncInboxRequest,
  type InboxFeedbackRequest,
  type ReadAllInboxRequest,
  type ReadAllInboxResponse,
  type ReplyInboxRequest,
  type SetInboxFlagsRequest,
  type SetToolGroupRequest,
  type SettleInboxReplyRequest,
  type ToolGroupListResponse,
  type ToolGroupView,
} from '../shared.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeInboxDeps {
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
}

export type InboxSeed = Pick<InboxMessageView, 'id' | 'title'> & Partial<InboxMessageView>;

const PAGE = 50;

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: `没有找到${what}。`, status: 404 });
}

function row(message: InboxMessageView): InboxRowView {
  const { body: _body, toAddress: _to, replies: _replies, replySends: _sends, ...view } = message;
  return view;
}

function inBox(message: InboxMessageView, box: NonNullable<InboxListQuery['box']>): boolean {
  if (box === 'archived') {
    return message.archived;
  }
  if (message.archived) {
    return false;
  }
  if (box === 'unread') {
    return !message.read;
  }
  if (box === 'starred') {
    return message.starred;
  }
  return box === 'all' || message.source === box;
}

export class FakeInbox implements InboxApi {
  syncState = { configured: false, lastSyncAt: null as string | null,
    lastCount: null as number | null, lastError: null as string | null };
  private readonly messages = new Map<string, InboxMessageView>();
  private readonly deps: FakeInboxDeps;
  private sequence = 0;

  constructor(deps: FakeInboxDeps) {
    this.deps = deps;
  }

  async sync(_input: SyncInboxRequest, signal?: AbortSignal) {
    this.deps.session.require();
    signal?.throwIfAborted();
    if (!this.syncState.configured) {
      throw new ApiError({ kind: 'failed', code: 'conflict', message: '邮箱尚未连接，暂时不能收信。', status: 409 });
    }
    this.syncState = { configured: true, lastSyncAt: this.deps.now().toISOString(), lastCount: 0, lastError: null };
    return { added: 0, sync: this.syncState };
  }

  async feedback(input: InboxFeedbackRequest): Promise<InboxRowResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('inbox', input.requestId, 'POST /v2/inbox/feedback', () => {
      const message = this.seed({ id: `feedback:${input.requestId}`, source: 'feedback',
        title: input.text.split('\n')[0] ?? input.text, body: input.text, fromAddress: '用户', fromName: '这台设备' });
      this.put(message);
      return { message: row(message), unread: this.unread() };
    });
  }

  async list(query: InboxListQuery): Promise<InboxListResponse> {
    this.deps.session.require();
    const box = query.box ?? 'all';
    const q = query.q ?? '';
    const all = [...this.messages.values()]
      .filter((message) => inBox(message, box))
      .filter((message) => q === '' || message.title.includes(q) || message.body.includes(q))
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const offset = query.offset ?? 0;
    const limit = query.limit ?? PAGE;
    const page = all.slice(offset, offset + limit);
    return {
      messages: page.map(row),
      total: all.length,
      nextOffset: offset + page.length < all.length ? offset + page.length : null,
      unread: this.unread(),
      sync: this.syncState,
    };
  }

  async get(id: string): Promise<InboxMessageView> {
    this.deps.session.require();
    const message = this.messages.get(id);
    if (message === undefined) {
      throw notFound('这封站内信');
    }
    return message;
  }

  async setFlags(id: string, input: SetInboxFlagsRequest): Promise<InboxRowResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('inbox', input.requestId, `POST /v2/inbox/${id}/flags`, () => {
      const message = this.messages.get(id);
      if (message === undefined) {
        throw notFound('这封站内信');
      }
      if (message.version !== input.version) {
        throw new ConflictError(row(message), '这封信在别处改过了，这次没有改。', '看最新的再改。');
      }
      const next = {
        ...message,
        read: input.read ?? message.read,
        starred: input.starred ?? message.starred,
        archived: input.archived ?? message.archived,
        version: message.version + 1,
      };
      this.put(next);
      return { message: row(next), unread: this.unread() };
    });
  }

  async readAll(input: ReadAllInboxRequest): Promise<ReadAllInboxResponse> {
    this.deps.session.require();
    return this.deps.receipts.run('inbox', input.requestId, 'POST /v2/inbox/read-all', () => {
      const changed = [...this.messages.values()].filter((message) => inBox(message, input.box) && !message.read);
      for (const message of changed) {
        this.put({ ...message, read: true, version: message.version + 1 });
      }
      return { changed: changed.length, unread: this.unread() };
    });
  }

  async reply(id: string, input: ReplyInboxRequest): Promise<InboxReplyView> {
    this.deps.session.require();
    return this.deps.receipts.run('inbox', input.requestId, `POST /v2/inbox/${id}/replies`, () => {
      const message = this.messages.get(id);
      if (message === undefined) {
        throw notFound('这封站内信');
      }
      if (message.source === 'email') {
        throw new ApiError({ kind: 'invalid', code: 'invalid_input', status: 400,
          message: '邮件不支持回复；请使用邮箱处理这封邮件。' });
      }
      this.sequence += 1;
      const reply: InboxReplyView = {
        id: `reply_${this.sequence}`,
        text: input.text,
        status: 'stored',
        statusLabel: '记下了',
        createdAt: this.deps.now().toISOString(),
        sentAt: null,
        error: '这个来源没有外发的去处，回复只记在站内信里。',
        version: 1,
      };
      this.messages.set(id, { ...message, replies: [...message.replies, reply] });
      return reply;
    });
  }

  async settleReply(replyId: string, input: SettleInboxReplyRequest): Promise<InboxReplyView> {
    this.deps.session.require();
    return this.deps.receipts.run('inbox', input.requestId, `POST /v2/inbox/replies/${replyId}/settle`, () => {
      for (const message of this.messages.values()) {
        const reply = message.replies.find((candidate) => candidate.id === replyId);
        if (reply !== undefined) {
          return reply;
        }
      }
      throw notFound('这条回复');
    });
  }

  seed(seed: InboxSeed, emit = false): InboxMessageView {
    const message: InboxMessageView = {
      source: 'email',
      sourceLabel: INBOX_BOX_LABELS[seed.source ?? 'email'],
      fromAddress: 'friend@example.com',
      fromName: null,
      preview: (seed.body ?? '').slice(0, 160),
      receivedAt: this.deps.now().toISOString(),
      read: false,
      starred: false,
      archived: false,
      act: false,
      attachments: [],
      migrated: false,
      version: 1,
      body: '',
      toAddress: null,
      replies: [],
      replySends: (seed.source ?? 'email') === 'email',
      ...seed,
    };
    if (emit) {
      this.put(message);
    } else {
      this.messages.set(message.id, message);
    }
    return message;
  }

  find(id: string): InboxMessageView | undefined {
    return this.messages.get(id);
  }

  /** 全部信（假联系人按发件地址和来源归并用）。 */
  all(): InboxMessageView[] {
    return [...this.messages.values()];
  }

  /** 联系人里打开这一来源就算读过（假联系人的 read 调）。 */
  markRead(ids: readonly string[]): void {
    for (const id of ids) {
      const message = this.messages.get(id);
      if (message !== undefined && !message.read) {
        this.put({ ...message, read: true, version: message.version + 1 });
      }
    }
  }

  /**
   * 联系人里回邮件（第 113 条：邮件能回，用户点发送才发）：开发期干跑只记不发，和真服务端一样记成 dry_run。
   * 由假联系人的 send 调，幂等在那里按 requestId 做。
   */
  appendReply(id: string, text: string): InboxReplyView {
    const message = this.messages.get(id);
    if (message === undefined) {
      throw notFound('这封站内信');
    }
    this.sequence += 1;
    const reply: InboxReplyView = {
      id: `reply_${this.sequence}`,
      text,
      status: 'dry_run',
      statusLabel: '干跑：只记不发',
      createdAt: this.deps.now().toISOString(),
      sentAt: null,
      error: null,
      version: 1,
    };
    this.put({ ...message, replies: [...message.replies, reply], version: message.version + 1 });
    return reply;
  }

  private unread(): InboxUnread {
    const live = [...this.messages.values()].filter((message) => !message.archived && !message.read);
    const bySource: Record<string, number> = {};
    for (const message of live) {
      bySource[message.source] = (bySource[message.source] ?? 0) + 1;
    }
    return { total: live.length, bySource };
  }

  private put(message: InboxMessageView): void {
    this.messages.set(message.id, message);
    this.deps.bus.emit({ type: 'inbox.changed', message: row(message), unread: this.unread() });
  }
}

export class FakeToolGroups implements ToolGroupsApi {
  private readonly rows = new Map<string, ToolGroupView>();
  private readonly deps: FakeInboxDeps;

  constructor(deps: FakeInboxDeps) {
    this.deps = deps;
    for (const group of TOOL_GROUPS) {
      this.rows.set(group.id, {
        id: group.id,
        label: group.label,
        description: group.description,
        tools: [...group.tools],
        enabled: group.defaultEnabled,
        version: 0,
        confirmedAt: null,
      });
    }
  }

  async list(): Promise<ToolGroupListResponse> {
    this.deps.session.require();
    return { groups: [...this.rows.values()] };
  }

  /** 本人会话核实之后由 FakeSigned 调。 */
  confirm(id: string, body: SetToolGroupRequest): ToolGroupView {
    const current = this.rows.get(id);
    if (current === undefined) {
      throw notFound('这个工具组');
    }
    if (current.version !== body.version) {
      throw new ConflictError(current, '这一组在别处改过了，这次没有改。', '看最新的再改。');
    }
    const confirmedAt = this.deps.now().toISOString();
    const next = { ...current, enabled: body.enabled, version: current.version + 1, confirmedAt };
    this.rows.set(id, next);
    this.deps.bus.emit({ type: 'tool_group.changed', group: next });
    return next;
  }
}
