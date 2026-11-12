import type { NetworkAttachmentView } from '../shared.ts';
// 假联系人（第 113 条）：网络上的人在这里存着（聊天、任务卡、代你说过、安全码），邮件和系统来源从假站内信归并出来。
// 写操作按 requestId 幂等（FakeReceipts），变了推 contact.item（那一项的新样子）和 contacts.changed（等你数、未读数），
// 和真服务端的两种 SSE 一样。本地开发时对方的 Plasticine 会过一会儿回一句、接下发出去的任务（replyMs > 0）；测试里
// replyMs 是 0，什么都不自己动，也不留定时器。

import type {
  AddContactRequest,
  ContactRequestDecision,
  ContactsApi,
  CreateGroupRequest,
  CreateNetworkTaskRequest,
  GroupRequest,
  UpdateGroupRequest,
  ReadContactRequest,
  SendContactMessageRequest,
  SetContactRelationRequest,
  ConfirmSafetyRequest,
  ContactAliasRequest,
  ContactPersonRequest,
  ContactReactionRequest,
  ContactRemoveRequest,
} from '../contacts-client.ts';
import { fakeMemory, messageIn, replyLine, withReaction } from './fake-contact-edits.ts';
import { ApiError, ConflictError } from '../errors.ts';
import {
  type ContactDetail,
  type ContactListResponse,
  type ContactMemory,
  type ContactLookupResponse,
  type GroupTaskView,
  type MemberFace,
  type ContactMessagesResponse,
  type ContactMessageView,
  type ContactRelation,
  type ContactRow,
  type ContactThreadItem,
  type MailBodyResponse,
  type NetworkTaskView,
} from '../shared.ts';
import {
  page,
  personDetail,
  personItems,
  personRow,
  sourceDetail,
  sourceGroups,
  sourceItems,
  sourceRow,
  taskWaiting,
  type PersonRecord,
  type SourceGroup,
} from './contact-records.ts';
import type { FakeEventBus } from './event-bus.ts';
import { FakeGroups, isGroupId } from './fake-groups.ts';
import type { FakeInbox } from './fake-inbox.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeContactsDeps {
  attachments?: (ids: readonly string[], thread: string, message: string) => NetworkAttachmentView[];
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  inbox: FakeInbox;
  now: () => Date;
  /** 本地开发里对方的 Plasticine 过多久回一句、接任务（毫秒）；0 = 不自己动（测试）。 */
  replyMs: number;
}

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: `没有找到${what}。`, status: 404 });
}

function refused(message: string, next?: string): ApiError {
  return new ApiError({ kind: 'failed', code: 'conflict', message, next, status: 409 });
}

function invalid(message: string, field?: string): ApiError {
  return new ApiError({ kind: 'invalid', code: 'invalid_request', message, field, status: 400 });
}

/** 一条任务换了状态：等不等我、更新时间、版本跟着走。 */
export function nextTask(task: NetworkTaskView, patch: Partial<NetworkTaskView>, now: Date): NetworkTaskView {
  const next = { ...task, ...patch, updatedAt: now.toISOString(), version: task.version + 1 };
  return { ...next, waiting: taskWaiting(next) };
}

export class FakeContacts implements ContactsApi {
  readonly people = new Map<string, PersonRecord>();
  readonly tasks = new Map<string, NetworkTaskView>();
  /** 网络上能加到的人：@handle → 显示名。不在这里的加不到（404）。 */
  readonly directory = new Map<string, string>();
  private readonly mailHtml = new Map<string, string>();
  private readonly deps: FakeContactsDeps;
  private sequence = 0;
  /** 我在群里的样子（预置按网络账号改）。 */
  me: MemberFace = { accountId: 'acct_me', name: 'Alex', handle: 'alex', avatar: null, self: true };
  readonly groupChats: FakeGroups;
  /** 记忆里的人物页（资料栏「记忆」一节能选的）和每页最近几行。 */
  readonly personPages: { id: string; title: string; lines: ContactMemory['lines'] }[] = [];

  constructor(deps: FakeContactsDeps) {
    this.deps = deps;
    this.groupChats = new FakeGroups({ session: deps.session, bus: deps.bus, receipts: deps.receipts, now: deps.now,
      me: () => this.me, friend: (id) => this.face(id), emitTotals: () => this.emitTotals(),
      later: (work) => this.later(work),
      ...(deps.attachments === undefined ? {} : { attachments: deps.attachments }) });
  }

  /** 好友在群里的样子（建群、拉人用）。 */
  face(contactId: string): MemberFace | null {
    const record = this.people.get(contactId);
    return record === undefined || record.state !== 'active' ? null : { accountId: `acct_${record.handle}`,
      name: record.name, handle: record.handle, avatar: record.avatar ?? null, self: false };
  }

  async list(): Promise<ContactListResponse> {
    this.deps.session.require();
    const all = [...this.people.values()];
    const rows = all.filter((record) => (record.removedAt ?? null) === null)
      .map((record) => personRow(record, this.tasks));
    const contacts = [...rows, ...this.groupChats.rows(), ...this.groups().map(sourceRow)]
      .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? ''));
    const removed = all.filter((record) => (record.removedAt ?? null) !== null)
      .map((record) => personRow(record, this.tasks));
    return { contacts, ...this.totals(contacts), removed };
  }

  async lookup(handle: string): Promise<ContactLookupResponse> {
    this.deps.session.require();
    const bare = handle.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^@/, '').split(/[./]/)[0] ?? '';
    const known = [...this.people.values()].find((record) => record.handle === bare);
    const name = known?.name ?? this.directory.get(bare);
    return { account: name === undefined ? null : { handle: bare, displayName: name },
      contactId: known?.id ?? null, state: known?.state ?? null };
  }

  async createGroup(input: CreateGroupRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, 'POST /v2/groups', () => this.groupChats.create(input));
  }

  async updateGroup(id: string, input: UpdateGroupRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/groups/${id}`,
      () => this.groupChats.update(id, input));
  }

  async leaveGroup(id: string, input: GroupRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/groups/${id}/leave`,
      () => this.groupChats.leave(id, input));
  }

  async createGroupTask(id: string, input: CreateNetworkTaskRequest): Promise<GroupTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/tasks`,
      () => this.groupChats.createTask(id, input));
  }

  async get(id: string): Promise<ContactDetail> {
    this.deps.session.require();
    if (isGroupId(id)) {
      return this.groupChats.detail(id);
    }
    const record = this.people.get(id);
    if (record !== undefined) {
      return { ...personDetail(record, this.tasks), memory: this.memoryOf(record) };
    }
    return sourceDetail(this.group(id));
  }

  async messages(id: string, query: { before?: string }): Promise<ContactMessagesResponse> {
    this.deps.session.require();
    if (isGroupId(id)) {
      return { ...page(this.groupChats.items(id), query.before), suggestion: null };
    }
    const record = this.people.get(id);
    const items = record === undefined ? sourceItems(this.group(id), this.mailHtml)
      : personItems(record, this.tasks);
    const suggestion = record?.suggestion ?? null;
    return { ...page(items, query.before), suggestion };
  }

  async mailBody(id: string, mailId: string): Promise<MailBodyResponse> {
    this.deps.session.require();
    const group = this.group(id);
    const message = group.kind === 'mail' ? group.messages.find((entry) => entry.id === mailId) : undefined;
    if (message === undefined) {
      throw notFound('这封邮件');
    }
    return { id: message.id, subject: message.title, fromName: message.fromName, fromAddress: message.fromAddress,
      toAddress: message.toAddress, at: message.receivedAt, html: this.mailHtml.get(message.id) ?? null,
      text: message.body, attachments: message.attachments };
  }

  /** 假邮件的 HTML 正文（真服务端是清洗过的 body_html）。 */
  seedMailHtml(mailId: string, html: string): void {
    this.mailHtml.set(mailId, html);
  }

  retryMessage(thread: string, id: string): ContactMessageView {
    const entries = this.people.get(thread)?.entries ?? this.groupChats.records.get(thread)?.entries ?? [];
    const entry = entries.find((item) => item.type === 'message' && item.message.id === id);
    if (entry?.type !== 'message' || entry.message.author !== 'me') throw notFound('这条消息');
    const message = { ...entry.message, status: 'sent' as const, error: null };
    entry.message = message;
    this.deps.bus.emit({ type: 'contact.item', contactId: thread, item: { type: 'message', message } });
    return message;
  }

  async send(id: string, input: SendContactMessageRequest): Promise<ContactMessageView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/messages`, () => {
      if (isGroupId(id)) {
        return this.groupChats.send(id, input);
      }
      const record = this.people.get(id);
      if (record === undefined) {
        return this.replyMail(id, input);
      }
      if (record.state === 'blocked' || record.state === 'request') {
        throw refused('还没和对方连上，这句没有发出去。', '先接受对方的请求。');
      }
      this.sequence += 1;
      const toAi = input.target === 'ai';
      const mine = input.target === 'mine';
      const message: ContactMessageView = {
        id: `cm_sent_${this.sequence}`,
        author: 'me',
        text: input.text,
        at: this.deps.now().toISOString(),
        status: 'sent',
        toAi,
        exchangeId: toAi || mine ? `ex_ask_${this.sequence}` : null,
        taskId: null,
        mention: toAi ? { name: record.name, self: false } : mine ? { name: this.me.name, self: true } : null,
        replyTo: input.replyToId === undefined ? null
          : replyLine(messageIn(record.entries, input.replyToId), { me: this.me.name, them: record.alias ?? record.name }),
      };
      message.attachments = this.deps.attachments?.(input.attachmentIds ?? [], id, message.id) ?? [];
      record.suggestion = null;
      this.post(record.id, message);
      if (mine) {
        this.later(() => this.post(record.id, { ...message, id: `cm_mine_${message.id}`,
          author: 'my_ai', attachments: [],
          text: `我只用${record.name}能听的资料回答：这件事资料里没有。`, at: this.deps.now().toISOString(), toAi: false,
          mention: null }));
      }
      if (toAi) {
        this.later(() => this.post(record.id, {
          ...message,
          id: `cm_ai_${message.id}`,
          author: 'their_ai', attachments: [],
          text: `我看了${record.name}标给你能听的材料，这件事要问一下${record.name}本人，问到了回你。`,
          at: this.deps.now().toISOString(),
          toAi: false,
        }));
      }
      return message;
    });
  }

  async add(input: AddContactRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, 'POST /v2/contacts/add', () => {
      const handle = input.handle.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^@/, '')
        .split(/[./]/)[0] ?? '';
      const known = [...this.people.values()].find((record) => record.handle === handle);
      if (known !== undefined) {
        return personRow(known, this.tasks);
      }
      const name = this.directory.get(handle);
      if (name === undefined) {
        throw new ApiError({ kind: 'not_found', code: 'not_found', status: 404, field: 'handle',
          message: `网络上没有 @${handle}。`, next: '核对一下拼写，或者请对方先加入网络。' });
      }
      const record = this.addPerson({ id: `c_${handle}`, name, handle, state: 'pending' });
      const note = input.note?.trim() ?? '';
      if (note !== '') {
        this.post(record.id, this.message(record.id, 'me', note));
      }
      this.later(() => {
        record.state = 'active';
        record.version += 1;
        this.post(record.id, this.message(record.id, 'them', '你好，加上了。'));
      });
      this.emitTotals();
      return personRow(record, this.tasks);
    });
  }

  async decideRequest(id: string, input: ContactRequestDecision): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/request`, () => {
      const record = this.person(id);
      if (record.state !== 'request') {
        throw refused('这条请求已经处理过了。');
      }
      if (input.decision === 'ignore') {
        this.people.delete(id);
      } else {
        record.state = input.decision === 'accept' ? 'active' : 'blocked';
        record.version += 1;
      }
      this.emitTotals();
      return personRow(record, this.tasks);
    });
  }

  async setAlias(id: string, input: ContactAliasRequest): Promise<ContactRow> {
    return this.edit(id, input, 'alias', (record) => {
      const alias = input.alias?.trim() ?? '';
      record.alias = alias === '' || alias === record.name ? null : alias;
    });
  }

  async setPerson(id: string, input: ContactPersonRequest): Promise<ContactRow> {
    return this.edit(id, input, 'person', (record) => {
      if (input.dismiss === true) {
        record.linkDismissed = true;
      } else if (input.create !== undefined) {
        const page = { id: `doc_person_${this.personPages.length + 1}`, title: input.create, lines: [] };
        this.personPages.push(page);
        record.personDocId = page.id;
      } else {
        record.personDocId = input.docId ?? null;
      }
    });
  }

  async remove(id: string, input: ContactRemoveRequest): Promise<ContactRow> {
    return this.edit(id, input, 'remove', (record) => {
      record.removedAt ??= this.deps.now().toISOString();
      record.relation = 'stranger';
      record.tierCap = null;
    });
  }

  async restore(id: string, input: ContactRemoveRequest): Promise<ContactRow> {
    return this.edit(id, input, 'restore', (record) => { record.removedAt = null; });
  }

  async react(id: string, messageId: string, input: ContactReactionRequest): Promise<void> {
    this.deps.session.require();
    await this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/messages/${messageId}/reaction`,
      () => {
        const entries = this.people.get(id)?.entries ?? this.groupChats.records.get(id)?.entries ?? [];
        const entry = entries.find((item) => item.type === 'message' && item.message.id === messageId);
        if (entry?.type !== 'message') throw notFound('这条消息');
        entry.message = withReaction(entry.message, input.emoji, input.on);
        this.deps.bus.emit({ type: 'contact.item', contactId: id, item: { type: 'message', message: entry.message } });
        return { ok: true };
      });
  }

  private edit(id: string, input: { requestId: string; version?: number }, what: string,
    change: (record: PersonRecord) => void): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/${what}`, () => {
      const record = this.person(id);
      if (input.version !== undefined && record.version !== input.version) {
        throw new ConflictError(personRow(record, this.tasks), '这个联系人在别处改过了，这次没有改。', '看最新的再改。');
      }
      change(record);
      record.version += 1;
      this.emitTotals();
      return personRow(record, this.tasks);
    });
  }

  private memoryOf(record: PersonRecord): ContactMemory {
    const people = this.personPages.map((page) => ({ id: page.id, title: page.title,
      linked: [...this.people.values()].filter((other) => other.personDocId === page.id && other.id !== record.id)
        .map((other) => other.alias ?? other.name) }));
    const docId = record.personDocId ?? null;
    const named = this.personPages.find((page) => page.title === record.name || page.title === record.alias);
    const suggest = record.linkDismissed === true ? null : named?.id ?? null;
    const lines = this.personPages.find((page) => page.id === docId)?.lines ?? [];
    return fakeMemory(docId, suggest, people, lines);
  }

  async confirmSafety(id: string, input: ConfirmSafetyRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/safety`, () => {
      const record = this.person(id);
      if (record.version !== input.version) {
        throw new ConflictError(personRow(record, this.tasks), '这个联系人在别处改过了，这次没有改。', '看最新的再核对。');
      }
      record.safetyChanged = false;
      record.version += 1;
      this.emitTotals();
      return personRow(record, this.tasks);
    });
  }

  async setRelation(id: string, input: SetContactRelationRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/relation`, () => {
      const record = this.person(id);
      if (record.version !== input.version) {
        throw new ConflictError(personRow(record, this.tasks), '这个联系人在别处改过了，这次没有改。', '看最新的再改。');
      }
      if (input.relation !== undefined) {
        record.relation = input.relation;
      }
      if (input.tierCap !== undefined) {
        record.tierCap = input.tierCap;
      }
      record.version += 1;
      this.emitTotals();
      return personRow(record, this.tasks);
    });
  }

  async read(id: string, input: ReadContactRequest): Promise<ContactRow> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/read`, () => {
      if (isGroupId(id)) {
        return this.groupChats.read(id);
      }
      const record = this.people.get(id);
      if (record === undefined) {
        const group = this.group(id);
        this.deps.inbox.markRead(group.messages.filter((message) => message.receivedAt <= input.upTo)
          .map((message) => message.id));
        this.emitTotals();
        return sourceRow(this.group(id));
      }
      record.unread = 0;
      this.emitTotals();
      return personRow(record, this.tasks);
    });
  }

  async createTask(id: string, input: CreateNetworkTaskRequest): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/contacts/${id}/tasks`, () => {
      const record = this.person(id);
      if (record.state !== 'active') {
        throw refused('对方还没接受，任务发不出去。', '等对方接受之后再发。');
      }
      this.sequence += 1;
      const at = this.deps.now().toISOString();
      const task: NetworkTaskView = {
        id: `nt_sent_${this.sequence}`,
        direction: 'out',
        contactId: id,
        title: input.title,
        goal: input.goal,
        acceptance: input.acceptance ?? input.goal,
        deadline: input.deadline ?? null,
        attachment: input.attachment ?? null,
        state: 'offered',
        doer: null,
        stage: 1,
        waiting: false,
        delivery: null,
        verdict: null,
        localTaskId: null,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
      record.entries.push({ type: 'task', taskId: task.id });
      this.putTask(task);
      this.later(() => {
        const held = this.tasks.get(task.id);
        if (held?.state === 'offered') {
          this.putTask(nextTask(held, { state: 'in_progress', doer: 'ai', stage: 2 }, this.deps.now()));
        }
      });
      return task;
    });
  }

  // ---------- 给假任务、预置数据和测试用 ----------

  addPerson(seed: Pick<PersonRecord, 'id' | 'name' | 'handle'> & Partial<PersonRecord>): PersonRecord {
    const record: PersonRecord = {
      relation: 'stranger',
      state: 'active',
      unread: 0,
      version: 1,
      tierCap: null,
      entries: [],
      said: [],
      safetyCode: safetyCodeOf(seed.handle),
      safetyChanged: false,
      suggestion: null,
      ...seed,
    };
    this.people.set(record.id, record);
    return record;
  }

  /** 预置一句话（不推事件）。 */
  seedMessage(contactId: string, message: ContactMessageView): void {
    this.person(contactId).entries.push({ type: 'message', message });
  }

  /** 预置一条任务（不推事件）。 */
  seedTask(task: NetworkTaskView): void {
    this.tasks.set(task.id, task);
    this.person(task.contactId).entries.push({ type: 'task', taskId: task.id });
  }

  task(id: string): NetworkTaskView {
    const task = this.tasks.get(id);
    if (task === undefined) {
      throw notFound('这条任务');
    }
    return task;
  }

  /** 任务变了：换上新的，推这张卡和总数。 */
  putTask(task: NetworkTaskView): void {
    this.tasks.set(task.id, task);
    this.deps.bus.emit({ type: 'contact.item', contactId: task.contactId, item: { type: 'task', at: task.createdAt,
      task } });
    this.emitTotals();
  }

  /** 聊天里多了一句：推它所在的那一项（可能已经收进一段 AI↔AI）和总数。 */
  post(contactId: string, message: ContactMessageView): void {
    const record = this.person(contactId);
    record.entries.push({ type: 'message', message });
    if (message.author === 'them' || message.author === 'their_ai') {
      record.unread += 1;
    }
    const item = personItems(record, this.tasks).find((candidate) => contains(candidate, message.id));
    if (item !== undefined) {
      this.deps.bus.emit({ type: 'contact.item', contactId, item });
    }
    this.emitTotals();
  }

  message(contactId: string, author: ContactMessageView['author'], text: string): ContactMessageView {
    this.sequence += 1;
    return { id: `cm_${contactId}_${this.sequence}`, author, text, at: this.deps.now().toISOString(),
      status: 'sent', toAi: false, exchangeId: null, taskId: null };
  }

  /** 三类联系人各几个人（对外可见的矩阵上半）：只数接上了的人。 */
  relationCounts(): Record<ContactRelation, number> {
    const counts: Record<ContactRelation, number> = { stranger: 0, partner: 0, friend: 0 };
    for (const record of this.people.values()) {
      if (record.state === 'active') {
        counts[record.relation] += 1;
      }
    }
    return counts;
  }

  /** 本地开发里过一会儿再做（对方的回话、对方接任务）；测试里 replyMs 是 0，不做。 */
  later(work: () => void): void {
    if (this.deps.replyMs <= 0) {
      return;
    }
    setTimeout(work, this.deps.replyMs);
  }

  private replyMail(id: string, input: SendContactMessageRequest): ContactMessageView {
    const group = this.group(id);
    if (group.kind !== 'mail') {
      throw invalid('这个来源只读，不能回。');
    }
    if (input.target === 'ai') {
      throw invalid('邮件联系人没有 Plasticine 可问。', 'target');
    }
    const latest = group.messages.at(-1);
    if (latest === undefined) {
      throw notFound('可以回的那封信');
    }
    const reply = this.deps.inbox.appendReply(latest.id, input.text);
    const message: ContactMessageView = { id: reply.id, author: 'me', text: reply.text, at: reply.createdAt,
      status: 'sent', toAi: false, exchangeId: null, taskId: null };
    this.deps.bus.emit({ type: 'contact.item', contactId: id, item: { type: 'message', message } });
    this.emitTotals();
    return message;
  }

  private person(id: string): PersonRecord {
    const record = this.people.get(id);
    if (record === undefined) {
      throw notFound('这个联系人');
    }
    return record;
  }

  private groups(): SourceGroup[] {
    return sourceGroups(this.deps.inbox.all());
  }

  private group(id: string): SourceGroup {
    const group = this.groups().find((candidate) => candidate.id === id);
    if (group === undefined) {
      throw notFound('这个联系人');
    }
    return group;
  }

  private totals(rows: readonly ContactRow[]): Omit<ContactListResponse, 'contacts'> {
    return {
      requests: rows.filter((row) => row.state === 'request').length,
      waiting: rows.filter((row) => row.waiting).length,
      unread: rows.reduce((sum, row) => sum + row.unread, 0),
    };
  }

  private emitTotals(): void {
    const rows = [...[...this.people.values()].map((record) => personRow(record, this.tasks)),
      ...this.groupChats.rows(), ...this.groups().map(sourceRow)];
    const { waiting, unread } = this.totals(rows);
    this.deps.bus.emit({ type: 'contacts.changed', waiting, unread });
  }
}

function contains(item: ContactThreadItem, messageId: string): boolean {
  if (item.type === 'message') {
    return item.message.id === messageId;
  }
  return item.type === 'exchange' && item.messages.some((message) => message.id === messageId);
}

/** 假的安全码：按 handle 算出 12 组 5 位数（真服务端是两边签名公钥的 SHA-256，见规格第 2 节）。 */
export function safetyCodeOf(handle: string): string {
  let seed = 7;
  for (const char of handle) {
    seed = (seed * 31 + char.charCodeAt(0)) % 99_991;
  }
  const groups: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    seed = (seed * 48_271 + 12_345) % 99_991;
    groups.push(String(seed).padStart(5, '0'));
  }
  return groups.join(' ');
}
