// 群聊（2026-11-05 他定）：建群拉好友进来，消息端到端加密——发件方给每个成员各封一封（和一对一同一套信封、同一个
// 发件箱，那几行带 group_id，不进一对一的聊天），中继看不到群，也看不到群里说了什么。
// 群的样子（名字、头像、成员）每次变都把全量发给每个成员（group_update），晚到的覆盖早的（按 at）。
// 收信只认：好友拉我进的群；已经在的群里、还在群里的人发来的。成员里不是好友的人记成 member（只为了给他加密）。
// 群里 @ 某人的 AI：那个人的 Plasticine 按全群最低的那一档回答（groupReach）。

import { RELATION_REACH, TIERS, type Tier } from '../../shared/api/visibility.ts';
import { GROUP_MEMBERS_MAX, type NetAccount, type Plaintext } from '../../shared/net-wire.ts';
import type { MessageAuthor } from '../../shared/api/contacts.ts';
import type { Contact, Group, GroupMessage, NetworkIdentity } from '../../shared/state.ts';
import type { Changes } from '../attention/index.ts';
import type { MemberInput, StateService } from '../state/index.ts';
import { groupChange, requireIdentity, type NetworkContext } from './context.ts';
import { NetworkError } from './errors.ts';
import { enqueue } from './outbox.ts';
import { reachOf } from './visibility.ts';

const LEFT_NOTE = '退出了群';
const JOINED_NOTE = '进了群';
const RENAMED_NOTE = '把群名改成了';

/** 群里给 AI 用的档位：每个别的成员能听到的台阶取交集（= 最低那一档）。不是好友的人按陌生人。 */
export function groupReach(state: Pick<StateService, 'groupMembers' | 'contacts'>, groupId: string, me: string):
  readonly Tier[] {
  let reach: readonly Tier[] = TIERS.filter((tier) => tier !== 'private');
  for (const member of state.groupMembers.current(groupId)) {
    if (member.accountId === me) {
      continue;
    }
    const contact = state.contacts.byAccount(member.accountId);
    const theirs = contact !== undefined && contact.state === 'active' ? reachOf(contact) : RELATION_REACH.stranger;
    reach = reach.filter((tier) => theirs.includes(tier));
  }
  return reach;
}

function memberInputOf(identity: NetworkIdentity): MemberInput {
  return { accountId: identity.accountId, handle: identity.handle, displayName: identity.displayName };
}

function snapshot(context: NetworkContext, group: Group, op: 'sync' | 'leave'): Plaintext<'group_update'> {
  const members = context.state.groupMembers.current(group.id).map((member) => ({ accountId: member.accountId,
    handle: member.handle, displayName: member.displayName }));
  return { groupId: group.id, op, name: group.name, avatar: group.avatar, ownerId: group.ownerAccountId,
    members, at: context.now().toISOString() };
}

/** 发给群里别的每个人（跳过自己、拉黑了的、没有钥匙的）。 */
function fanOut(context: NetworkContext, group: Group, send: (contact: Contact) => void, extra: string[] = []): void {
  const identity = requireIdentity(context);
  const accounts = new Set([...context.state.groupMembers.current(group.id).map((member) => member.accountId),
    ...extra]);
  for (const accountId of accounts) {
    if (accountId === identity.accountId) {
      continue;
    }
    const contact = context.state.contacts.byAccount(accountId);
    if (contact === undefined || contact.state === 'blocked') {
      continue;
    }
    send(contact);
  }
}

function broadcastUpdate(context: NetworkContext, group: Group, op: 'sync' | 'leave', extra: string[] = []): void {
  const payload = snapshot(context, group, op);
  fanOut(context, group, (contact) => {
    enqueue(context, contact, { kind: 'group_update', author: 'me', text: group.name, payload, groupId: group.id });
  }, extra);
}

function note(context: NetworkContext, group: Group, author: string, text: string): GroupMessage {
  const at = context.now().toISOString();
  return context.state.groupMessages.create({ groupId: group.id, messageId: `note-${context.newId()}`,
    authorAccountId: author, author: 'system', kind: 'system', text, sentAt: at, readAt: at });
}

function touch(context: NetworkContext, group: Group, at: string): Group {
  const current = context.state.groups.require(group.id);
  return at > current.lastAt ? context.state.groups.update(current.id, current.version, { lastAt: at }) : current;
}

function friend(context: NetworkContext, contactId: string): Contact {
  const contact = context.state.contacts.get(contactId);
  if (contact === undefined || contact.state !== 'active') {
    throw new NetworkError('invalid_input', '只能拉互加了的好友进群。', 'members');
  }
  return contact;
}

export interface CreateGroupInput {
  name: string | null;
  memberIds: readonly string[];
  requestId: string;
}

/** 建群：自己 + 选的好友；没起名就用前三个人的名字。 */
export function createGroup(context: NetworkContext, input: CreateGroupInput): Group {
  const identity = requireIdentity(context);
  const contacts = [...new Set(input.memberIds)].map((id) => friend(context, id));
  if (contacts.length === 0) {
    throw new NetworkError('invalid_input', '至少选一个好友。', 'members');
  }
  if (contacts.length + 1 > GROUP_MEMBERS_MAX) {
    throw new NetworkError('invalid_input', `一个群最多 ${GROUP_MEMBERS_MAX} 人。`, 'members');
  }
  const groupId = `grp-${input.requestId}`.slice(0, 64);
  const existing = context.state.groups.get(groupId);
  if (existing !== undefined) {
    return existing;
  }
  return context.desk.commit((changes) => {
    const at = context.now().toISOString();
    const name = input.name?.trim() || contacts.slice(0, 3).map((contact) => contact.displayName).join('、');
    const group = context.state.groups.create(groupId, { ownerAccountId: identity.accountId, name, lastAt: at });
    context.state.groupMembers.upsert(group.id, memberInputOf(identity));
    for (const contact of contacts) {
      context.state.groupMembers.upsert(group.id, { accountId: contact.accountId, handle: contact.handle,
        displayName: contact.displayName });
    }
    broadcastUpdate(context, group, 'sync');
    afterGroup(context, changes, group.id, []);
    return group;
  });
}

export interface UpdateGroupInput {
  name?: string;
  /** data URL；null = 换回拼起来的成员头像。 */
  avatar?: string | null;
  addIds?: readonly string[];
}

/** 改群名、换群头像、拉人：任何成员都能做，改完把全量发给每个人（新进来的也收到）。 */
export function updateGroup(context: NetworkContext, groupId: string, input: UpdateGroupInput): Group {
  const identity = requireIdentity(context);
  const adding = (input.addIds ?? []).map((id) => friend(context, id));
  return context.desk.commit((changes) => {
    let group = requireGroup(context, groupId);
    const notes: string[] = [];
    if (input.name !== undefined && input.name.trim() !== '' && input.name.trim() !== group.name) {
      group = context.state.groups.update(group.id, group.version, { name: input.name.trim() });
      notes.push(note(context, group, identity.accountId, `你${RENAMED_NOTE}「${group.name}」`).id);
    }
    if (input.avatar !== undefined) {
      group = context.state.groups.update(group.id, group.version, { avatar: input.avatar });
    }
    for (const contact of adding) {
      if (context.state.groupMembers.current(group.id).length >= GROUP_MEMBERS_MAX) {
        throw new NetworkError('invalid_input', `一个群最多 ${GROUP_MEMBERS_MAX} 人。`, 'members');
      }
      if (context.state.groupMembers.upsert(group.id, { accountId: contact.accountId, handle: contact.handle,
        displayName: contact.displayName })) {
        notes.push(note(context, group, contact.accountId, `${contact.displayName} ${JOINED_NOTE}`).id);
      }
    }
    group = touch(context, group, context.now().toISOString());
    broadcastUpdate(context, group, 'sync');
    afterGroup(context, changes, group.id, notes);
    return group;
  });
}

/** 退群：告诉每个人我走了；之后不再收发，聊天留着。 */
export function leaveGroup(context: NetworkContext, groupId: string): Group {
  const identity = requireIdentity(context);
  return context.desk.commit((changes) => {
    const group = requireGroup(context, groupId);
    broadcastUpdate(context, group, 'leave');
    context.state.groupMembers.leave(group.id, identity.accountId);
    const left = context.state.groups.update(group.id, group.version, { leftAt: context.now().toISOString() });
    afterGroup(context, changes, group.id, []);
    return left;
  });
}

export function requireGroup(context: Pick<NetworkContext, 'state'>, groupId: string): Group {
  const group = context.state.groups.get(groupId);
  if (group === undefined) {
    throw new NetworkError('not_found', '没有这个群。');
  }
  if (group.leftAt !== null) {
    throw new NetworkError('conflict', '你已经退出这个群了。');
  }
  return group;
}

export interface GroupPost {
  attachmentIds?: string[];
  kind: 'text' | 'ask_ai' | 'ai_text';
  text: string;
  target: string | null;
  exchangeId: string | null;
  author: MessageAuthor;
  requestId: string | null;
}

/** 在群里说一句（自己记一行、给每个成员各一封）。同一个 requestId 再来拿回原来那句。 */
export function postGroupMessage(context: NetworkContext, changes: Changes, group: Group, post: GroupPost):
  GroupMessage | null {
  const identity = requireIdentity(context);
  if (post.requestId !== null) {
    const earlier = context.state.groupMessages.byRequest(post.requestId);
    if (earlier !== undefined) {
      return earlier;
    }
  }
  const attachments = context.state.networkAttachments.outgoing(post.attachmentIds ?? [], identity.accountId);
  if (post.text.trim() === '' && attachments.length === 0) {
    throw new NetworkError('invalid_input', '写一句话或添加附件再发送。');
  }
  const at = context.now().toISOString();
  const messageId = context.newId();
  const message = context.state.groupMessages.create({ groupId: group.id, messageId,
    authorAccountId: identity.accountId, author: post.author, kind: post.kind, text: post.text,
    targetAccountId: post.target, exchangeId: post.exchangeId, sentAt: at, requestId: post.requestId, readAt: at });
  const payload: Plaintext<'group_message'> = { groupId: group.id, messageId, kind: post.kind, text: post.text,
    target: post.target, exchangeId: post.exchangeId, ...(attachments.length === 0 ? {} : { attachments }) };
  const recipients: string[] = [];
  fanOut(context, group, (contact) => {
    recipients.push(contact.accountId);
    enqueue(context, contact, { kind: 'group_message', author: post.author, text: post.text, payload,
      groupId: group.id });
  });
  context.state.networkAttachments.bind(post.attachmentIds ?? [], group.id, message.id, true, recipients);
  touch(context, group, at);
  afterGroup(context, changes, group.id, [message.id]);
  return message;
}

export function afterGroup(context: NetworkContext, changes: Changes, groupId: string, messageIds: string[],
  taskIds: string[] = []): void {
  changes.afterCommit(() => {
    context.kickOutbox();
    context.changed(groupChange(groupId, messageIds, taskIds));
  });
}

// ---------- 收到的 ----------

/** 群里出现了不认识的人：记成 member（只为了给他加密发信），不进联系人列表。 */
function ensureMember(context: NetworkContext, account: NetAccount | undefined, member: MemberInput): void {
  const known = context.state.contacts.byAccount(member.accountId);
  if (known !== undefined || account === undefined) {
    return;
  }
  context.state.contacts.create({ accountId: account.id, handle: account.handle, displayName: member.displayName,
    signingKey: account.signingKey, encryptionKey: account.encryptionKey, state: 'member',
    lastAt: context.now().toISOString() });
}

export interface GroupReceipt {
  groupId: string;
  messageIds: string[];
  /** 问我的 Plasticine 的那句（群消息 id），提交以后交给 responder。 */
  question: string | null;
}

/**
 * 群的样子变了。不认识的群只收好友拉的；认识的群只收还在群里的人发的、比本机记的新的。accounts：成员里本机还没有
 * 钥匙的那些人（inbound.ts 在事务外先向中继查好）。
 */
export function receiveGroupUpdate(context: NetworkContext, sender: Contact, payload: Plaintext<'group_update'>,
  accounts: ReadonlyMap<string, NetAccount>): GroupReceipt | null {
  const identity = requireIdentity(context);
  const { state } = context;
  let group = state.groups.get(payload.groupId);
  const senderIn = group !== undefined && state.groupMembers.get(group.id, sender.accountId)?.leftAt === null;
  if (group === undefined ? sender.state !== 'active' : !senderIn) {
    return null;
  }
  const notes: string[] = [];
  if (payload.op === 'leave') {
    if (group === undefined) {
      return null;
    }
    state.groupMembers.leave(group.id, sender.accountId);
    notes.push(note(context, group, sender.accountId, `${sender.displayName} ${LEFT_NOTE}`).id);
    return { groupId: group.id, messageIds: notes, question: null };
  }
  if (!payload.members.some((member) => member.accountId === identity.accountId)) {
    return null;
  }
  if (group === undefined) {
    group = state.groups.create(payload.groupId, { ownerAccountId: payload.ownerId, name: payload.name,
      avatar: payload.avatar, lastAt: payload.at });
  } else if (payload.at >= group.updatedAt) {
    if (payload.name !== group.name) {
      notes.push(note(context, group, sender.accountId, `${sender.displayName} ${RENAMED_NOTE}「${payload.name}」`).id);
    }
    group = state.groups.update(group.id, group.version, { name: payload.name, avatar: payload.avatar,
      leftAt: null });
  }
  const before = new Set(state.groupMembers.current(group.id).map((member) => member.accountId));
  for (const member of payload.members) {
    ensureMember(context, accounts.get(member.accountId), member);
    state.groupMembers.upsert(group.id, member);
    if (before.size > 0 && !before.has(member.accountId) && member.accountId !== identity.accountId) {
      notes.push(note(context, group, member.accountId, `${member.displayName} ${JOINED_NOTE}`).id);
    }
  }
  touch(context, group, context.now().toISOString());
  return { groupId: group.id, messageIds: notes, question: null };
}

/** 群里的一句：只收还在群里的人发的；问我的 Plasticine 的那句交给 responder。 */
export function receiveGroupMessage(context: NetworkContext, sender: Contact, payload: Plaintext<'group_message'>):
  GroupReceipt | null {
  const identity = requireIdentity(context);
  const { state } = context;
  const group = state.groups.get(payload.groupId);
  if (group === undefined || group.leftAt !== null
    || state.groupMembers.get(group.id, sender.accountId)?.leftAt !== null) {
    return null;
  }
  if (state.groupMessages.byMessageId(group.id, payload.messageId) !== undefined) {
    return null;
  }
  const at = context.now().toISOString();
  const message = state.groupMessages.create({ groupId: group.id, messageId: payload.messageId,
    authorAccountId: sender.accountId, author: payload.kind === 'ai_text' ? 'their_ai' : 'them', kind: payload.kind,
    text: payload.text, targetAccountId: payload.target, exchangeId: payload.exchangeId, sentAt: at });
  state.networkAttachments.receive(payload.attachments ?? [], sender.accountId, group.id, message.id, true);
  touch(context, group, at);
  const asksMe = payload.kind === 'ask_ai' && payload.target === identity.accountId;
  return { groupId: group.id, messageIds: [message.id], question: asksMe ? message.id : null };
}

/** 收到 group_update 前先看成员里哪些人本机还没有钥匙（要向中继查）。 */
export function unknownMembers(context: Pick<NetworkContext, 'state'>, payload: Plaintext<'group_update'>,
  me: string): string[] {
  return payload.members.map((member) => member.accountId)
    .filter((accountId) => accountId !== me && context.state.contacts.byAccount(accountId) === undefined);
}
