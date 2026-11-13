import type { NetworkAttachmentView } from '../shared.ts';
// 假的群聊（2026-11-05 群聊）：群和一对一走同一套联系人接口（id 以 grp- 开头），由假联系人转到这里。群里一句话带说话
// 的人；@ 某人的 Plasticine 过一会儿由它回一句（本地开发）；群任务卡指给某人或全群谁先接谁做，「我来接」「让 Plasticine
// 接」立刻接到（假的没有别人抢）。变了推 contact.item 和 contacts.changed，和真服务端一样。

import type { ClaimGroupTaskRequest, CreateGroupRequest, CreateNetworkTaskRequest, GroupRequest, GroupTasksApi,
  SendContactMessageRequest, UpdateGroupRequest } from '../contacts-client.ts';
import { ApiError } from '../errors.ts';
import {
  GROUP_ID_PREFIX,
  type ContactDetail,
  type ContactMessageView,
  type ContactRow,
  type ContactThreadItem,
  type GroupTaskView,
  type MemberFace,
  type NetworkTaskView,
} from '../shared.ts';
import { messageIn, replyLine } from './fake-contact-edits.ts';
import type { FakeEventBus } from './event-bus.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

/** 群头像拼前 9 个人。 */
const FACES_SHOWN = 9;
const CARD_FACES = 5;

export type GroupEntry = { type: 'message'; message: ContactMessageView } | { type: 'task'; taskId: string; at: string };

export interface GroupRecord {
  id: string;
  name: string;
  avatar: string | null;
  members: MemberFace[];
  entries: GroupEntry[];
  unread: number;
  version: number;
  left: boolean;
}

export interface FakeGroupsDeps {
  attachments?: (ids: readonly string[], thread: string, message: string) => NetworkAttachmentView[];
  session: FakeSession;
  bus: FakeEventBus;
  receipts: FakeReceipts;
  now: () => Date;
  /** 我（群里 self = true 的那个人）。 */
  me: () => MemberFace;
  /** 好友：联系人 id → 群里的样子（建群、拉人用）。 */
  friend: (contactId: string) => MemberFace | null;
  emitTotals: () => void;
  later: (work: () => void) => void;
}

function notFound(what: string): ApiError {
  return new ApiError({ kind: 'not_found', code: 'not_found', message: `没有找到${what}。`, status: 404 });
}

function refused(message: string): ApiError {
  return new ApiError({ kind: 'failed', code: 'conflict', message, status: 409 });
}

export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_ID_PREFIX);
}

export class FakeGroups implements GroupTasksApi {
  readonly records = new Map<string, GroupRecord>();
  readonly tasks = new Map<string, GroupTaskView>();
  private readonly deps: FakeGroupsDeps;
  private sequence = 0;

  constructor(deps: FakeGroupsDeps) {
    this.deps = deps;
  }

  // ---------- 读 ----------

  rows(): ContactRow[] {
    return [...this.records.values()].filter((record) => !record.left).map((record) => this.row(record));
  }

  row(record: GroupRecord): ContactRow {
    const last = [...record.entries].reverse().find((entry) => entry.type === 'task'
      || entry.message.author !== 'system');
    const preview = last === undefined ? null : last.type === 'message'
      ? { text: last.message.text, at: last.message.at, author: last.message.author,
        ...(last.message.sender === null || last.message.sender === undefined || last.message.sender.self ? {}
          : { sender: last.message.sender.name }) }
      : this.taskPreview(last.taskId, last.at);
    return {
      id: record.id, kind: 'group', name: record.name, handle: null, address: null, relation: null, state: 'active',
      last: preview, unread: record.unread, waiting: this.waiting(record), canSend: !record.left,
      version: record.version, avatar: record.avatar, members: record.members.slice(0, FACES_SHOWN),
      memberCount: record.members.length,
    };
  }

  detail(id: string): ContactDetail {
    const record = this.record(id);
    return { contact: this.row(record), tierCap: null, deliveries: [], said: [], safetyCode: null,
      safetyChanged: false, members: record.members };
  }

  items(id: string): ContactThreadItem[] {
    return this.record(id).entries.flatMap((entry): ContactThreadItem[] => {
      if (entry.type === 'message') {
        return [{ type: 'message', message: entry.message }];
      }
      const task = this.tasks.get(entry.taskId);
      return task === undefined ? [] : [{ type: 'group_task', at: entry.at, task }];
    });
  }

  private taskPreview(taskId: string, at: string): ContactRow['last'] {
    const task = this.tasks.get(taskId);
    return task === undefined ? null : { text: task.title, at, author: task.owner.self ? 'me' : 'them',
      ...(task.owner.self ? {} : { sender: task.owner.name }) };
  }

  private waiting(record: GroupRecord): boolean {
    return record.entries.some((entry) => {
      const task = entry.type === 'task' ? this.tasks.get(entry.taskId) : undefined;
      return task !== undefined && (task.pair?.waiting === true || (task.canClaim && task.assignee?.self === true));
    });
  }

  record(id: string): GroupRecord {
    const record = this.records.get(id);
    if (record === undefined) {
      throw notFound('这个群');
    }
    return record;
  }

  // ---------- 写 ----------

  send(id: string, input: SendContactMessageRequest): ContactMessageView {
    const record = this.record(id);
    const target = input.aiOf === undefined ? null : record.members.find((member) => member.accountId === input.aiOf);
    const message = this.message(record, 'me', input.text, this.deps.me(),
      target === null || target === undefined ? null : { name: target.name, self: target.self });
    message.attachments = this.deps.attachments?.(input.attachmentIds ?? [], id, message.id) ?? [];
    if (input.replyToId !== undefined) {
      message.replyTo = replyLine(messageIn(record.entries, input.replyToId), { me: this.deps.me().name, them: '' });
    }
    this.post(record, message);
    // 同一句还 @ 了别人的 Plasticine：和真服务端一样各记一句同样的话（界面并成一个气泡），各回各的。
    const more = target === null || target === undefined ? [] : (input.alsoAiOf ?? [])
      .map((accountId) => record.members.find((member) => member.accountId === accountId))
      .filter((member) => member !== undefined && member.accountId !== target.accountId) as MemberFace[];
    for (const member of more) {
      this.post(record, this.message(record, 'me', input.text, this.deps.me(),
        { name: member.name, self: member.self }));
    }
    for (const member of target === null || target === undefined ? [] : [target, ...more]) {
      this.deps.later(() => this.post(record, this.message(record, member.self ? 'my_ai' : 'their_ai',
        '我只用群里每个人都能听的资料回答，这件事资料里没有。', member)));
    }
    return message;
  }

  createTask(id: string, input: CreateNetworkTaskRequest): GroupTaskView {
    const record = this.record(id);
    this.sequence += 1;
    const at = this.deps.now().toISOString();
    const assignee = input.assignee === undefined || input.assignee === null ? null
      : record.members.find((member) => member.accountId === input.assignee) ?? null;
    const task: GroupTaskView = { id: `gt_sent_${this.sequence}`, groupId: id, title: input.title, goal: input.goal,
      deadline: input.deadline ?? null, attachment: input.attachment ?? null, owner: this.deps.me(), assignee,
      claimer: null, doer: null, state: 'open', claiming: false, canClaim: false,
      members: record.members.slice(0, CARD_FACES), pair: null, offeredAt: at, claimedAt: null, version: 1 };
    record.entries.push({ type: 'task', taskId: task.id, at });
    this.putTask(task, at);
    return task;
  }

  async get(id: string): Promise<GroupTaskView> {
    this.deps.session.require();
    return structuredClone(this.task(id));
  }

  async claim(id: string, input: ClaimGroupTaskRequest): Promise<GroupTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/group-tasks/${id}/claim`, () => {
      const task = this.task(id);
      if (!task.canClaim) {
        throw refused('这张卡已经有人接了。');
      }
      const at = this.deps.now().toISOString();
      const me = this.deps.me();
      const pair: NetworkTaskView = { id: task.id, direction: 'in', contactId: task.owner.accountId,
        title: task.title, goal: task.goal, acceptance: task.goal, deadline: task.deadline,
        state: input.doer === 'ai' ? 'in_progress' : 'accepted', doer: input.doer, stage: 2,
        waiting: input.doer === 'person', delivery: null, verdict: null, localTaskId: null,
        activity: input.doer === 'ai' ? { text: '在查资料…', since: at } : null, attachment: task.attachment,
        decidedAt: at, createdAt: task.offeredAt, updatedAt: at, version: 1 };
      const next: GroupTaskView = { ...task, state: input.doer === 'ai' ? 'in_progress' : 'claimed', claimer: me,
        doer: input.doer, canClaim: false, claiming: false, pair, claimedAt: at, version: task.version + 1 };
      this.putTask(next);
      return next;
    });
  }

  async cancel(id: string, input: GroupRequest): Promise<GroupTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/group-tasks/${id}/cancel`, () => {
      const task = this.task(id);
      if (task.state !== 'open' || !task.owner.self) {
        throw refused('已经有人接了，撤不回。');
      }
      const next: GroupTaskView = { ...task, state: 'cancelled', version: task.version + 1 };
      this.putTask(next);
      return next;
    });
  }

  create(input: CreateGroupRequest): ContactRow {
    const members = [this.deps.me(), ...input.memberIds.map((id) => this.deps.friend(id))
      .filter((member): member is MemberFace => member !== null)];
    this.sequence += 1;
    const name = input.name?.trim() || members.slice(1, 4).map((member) => member.name).join('、');
    const record: GroupRecord = { id: `${GROUP_ID_PREFIX}${input.requestId}`, name, avatar: null, members,
      entries: [], unread: 0, version: 1, left: false };
    this.records.set(record.id, record);
    this.deps.emitTotals();
    return this.row(record);
  }

  update(id: string, input: UpdateGroupRequest): ContactRow {
    const record = this.record(id);
    if (input.name !== undefined) {
      record.name = input.name;
      this.post(record, this.message(record, 'system', `你把群名改成了「${input.name}」`, this.deps.me()));
    }
    if (input.avatar !== undefined) {
      record.avatar = input.avatar;
    }
    for (const contactId of input.addIds ?? []) {
      const member = this.deps.friend(contactId);
      if (member !== null && !record.members.some((entry) => entry.accountId === member.accountId)) {
        record.members.push(member);
        this.post(record, this.message(record, 'system', `${member.name} 进了群`, member));
      }
    }
    record.version += 1;
    this.deps.emitTotals();
    return this.row(record);
  }

  leave(id: string, _input: GroupRequest): ContactRow {
    const record = this.record(id);
    record.left = true;
    record.version += 1;
    this.deps.emitTotals();
    return this.row(record);
  }

  read(id: string): ContactRow {
    const record = this.record(id);
    record.unread = 0;
    this.deps.emitTotals();
    return this.row(record);
  }

  // ---------- 预置 ----------

  seed(record: Omit<GroupRecord, 'entries' | 'unread' | 'version' | 'left'> & Partial<GroupRecord>): GroupRecord {
    const full: GroupRecord = { entries: [], unread: 0, version: 1, left: false, ...record };
    this.records.set(full.id, full);
    return full;
  }

  seedMessage(groupId: string, message: ContactMessageView): void {
    this.record(groupId).entries.push({ type: 'message', message });
  }

  seedTask(task: GroupTaskView): void {
    this.tasks.set(task.id, task);
    this.record(task.groupId).entries.push({ type: 'task', taskId: task.id, at: task.offeredAt });
  }

  task(id: string): GroupTaskView {
    const task = this.tasks.get(id);
    if (task === undefined) {
      throw notFound('这张任务卡');
    }
    return task;
  }

  putTask(task: GroupTaskView, at?: string): void {
    this.tasks.set(task.id, task);
    const placed = this.record(task.groupId).entries.find((entry) => entry.type === 'task' && entry.taskId === task.id);
    this.deps.bus.emit({ type: 'contact.item', contactId: task.groupId, item: { type: 'group_task',
      at: at ?? (placed?.type === 'task' ? placed.at : task.offeredAt), task } });
    this.deps.emitTotals();
  }

  private message(record: GroupRecord, author: ContactMessageView['author'], text: string, sender: MemberFace,
    mention: { name: string; self: boolean } | null = null): ContactMessageView {
    this.sequence += 1;
    return { id: `gm_${record.id}_${this.sequence}`, author, text, at: this.deps.now().toISOString(), status: 'sent',
      toAi: mention !== null, exchangeId: null, taskId: null, mention, sender: author === 'system' ? null : sender };
  }

  private post(record: GroupRecord, message: ContactMessageView): void {
    record.entries.push({ type: 'message', message });
    if (message.author === 'them' || message.author === 'their_ai') {
      record.unread += 1;
    }
    this.deps.bus.emit({ type: 'contact.item', contactId: record.id, item: { type: 'message', message } });
    this.deps.emitTotals();
  }
}
