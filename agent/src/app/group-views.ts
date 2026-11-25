import {
  CONTACT_MESSAGES_PAGE,
  type ContactDetail,
  type ContactMessageView,
  type ContactRow,
  type ContactThreadItem,
  type GroupTaskView,
  type MemberFace,
} from '../../shared/api/index.ts';
import type { Group, GroupMessage, GroupTask } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { networkTaskView, type TaskActivity, type TaskExecution } from './contact-views.ts';
import { foldReactions, type ReactionView } from '../network/index.ts';

const FACES_SHOWN = 9;
const CARD_FACES = 5;

export function faceOf(state: StateService, accountId: string, fallbackName = '群里的人'): MemberFace {
  const identity = state.networkIdentity.get();
  if (identity !== undefined && identity.accountId === accountId) {
    return { accountId, name: identity.displayName, handle: identity.handle, avatar: identity.avatar, self: true };
  }
  const contact = state.contacts.byAccount(accountId);
  const member = state.groupMembers.groupsOf(accountId).map((groupId) => state.groupMembers.get(groupId, accountId))
    .find((entry) => entry !== undefined);
  return { accountId, name: contact?.displayName ?? member?.displayName ?? fallbackName,
    handle: contact?.handle ?? member?.handle ?? '', avatar: contact?.avatar ?? null, self: false };
}

function faces(state: StateService, groupId: string, limit: number): MemberFace[] {
  return state.groupMembers.current(groupId).slice(0, limit).map((member) =>
    faceOf(state, member.accountId, member.displayName));
}

function waitingCards(state: StateService, groupId: string): boolean {
  const identity = state.networkIdentity.get();
  return state.groupTasks.forGroup(groupId).some((task) => {
    const pair = state.networkTasks.get(task.id);
    if (pair !== undefined) {
      return pair.askId !== null;
    }
    return identity !== undefined && task.state === 'open' && task.assigneeAccountId === identity.accountId;
  }) || state.asks.open().some((ask) => ask.purpose === 'network_reply' && ask.context?.['groupId'] === groupId);
}

export function groupRow(state: StateService, group: Group): ContactRow {
  const last = state.groupMessages.latest(group.id);
  const identity = state.networkIdentity.get();
  const sender = last === undefined || last.authorAccountId === identity?.accountId ? undefined
    : faceOf(state, last.authorAccountId).name;
  return {
    id: group.id,
    kind: 'group',
    name: group.name,
    handle: null,
    address: null,
    relation: null,
    state: 'active',
    last: last === undefined ? null : { text: last.text, at: last.sentAt, author: last.author,
      ...(sender === undefined ? {} : { sender }) },
    unread: state.groupMessages.unreadCount(group.id),
    waiting: waitingCards(state, group.id),
    canSend: group.leftAt === null,
    version: group.version,
    avatar: group.avatar,
    members: faces(state, group.id, FACES_SHOWN),
    memberCount: state.groupMembers.current(group.id).length,
  };
}

export function groupDetail(state: StateService, group: Group): ContactDetail {
  return { contact: groupRow(state, group), tierCap: null, deliveries: [], said: [], safetyCode: null,
    safetyChanged: false, members: faces(state, group.id, Number.MAX_SAFE_INTEGER) };
}

export function groupTaskView(state: StateService, task: GroupTask, activity?: TaskActivity, execution?: TaskExecution):
  GroupTaskView {
  const identity = state.networkIdentity.get();
  const me = identity?.accountId ?? '';
  const pair = state.networkTasks.get(task.id);
  const open = task.state === 'open';
  return {
    id: task.id,
    groupId: task.groupId,
    title: task.title,
    goal: task.goal,
    deadline: task.deadline,
    attachment: task.attachment,
    owner: faceOf(state, task.ownerAccountId),
    assignee: task.assigneeAccountId === null ? null : faceOf(state, task.assigneeAccountId),
    claimer: task.claimerAccountId === null || open ? null : faceOf(state, task.claimerAccountId),
    doer: task.doer,
    state: task.state,
    claiming: open && task.claimerAccountId === me,
    canClaim: open && task.ownerAccountId !== me && task.claimerAccountId !== me
      && (task.assigneeAccountId === null || task.assigneeAccountId === me),
    members: faces(state, task.groupId, CARD_FACES),
    pair: pair === undefined ? null : networkTaskView(pair, activity, execution),
    offeredAt: task.offeredAt,
    claimedAt: task.claimedAt,
    version: task.version,
  };
}

function groupReplyOf(state: StateService, message: GroupMessage): { author: string; text: string } | null {
  const target = message.replyTo == null ? undefined
    : state.groupMessages.byMessageId(message.groupId, message.replyTo);
  if (target === undefined) return null;
  const me = state.networkIdentity.get()?.accountId;
  return { author: target.authorAccountId === me ? '我' : faceOf(state, target.authorAccountId).name,
    text: target.text.slice(0, 80) };
}

export function groupMessageView(state: StateService, message: GroupMessage,
  reactions: ReadonlyMap<string, ReactionView[]> = foldReactions(state.contactMessages.groupReactions(message.groupId)))
  : ContactMessageView {
  const marks = reactions.get(message.messageId);
  const reply = groupReplyOf(state, message);
  const identity = state.networkIdentity.get();
  const outgoing = state.contactMessages.forGroupMessage(message.groupId, message.messageId);
  const failed = outgoing.find((row) => row.status === 'failed');
  const status = outgoing.some((row) => row.status === 'sending') ? 'sending'
    : failed === undefined ? 'sent' : 'failed';
  const target = message.targetAccountId;
  const mention = message.kind === 'ask_ai' && target !== null
    ? { name: faceOf(state, target).name, self: target === identity?.accountId } : null;
  return {
    id: message.id,
    author: message.author,
    text: message.text,
    at: message.sentAt,
    status,
    ...(failed === undefined ? {} : { error: failed.error ?? '部分对象未收到，请重试。' }),
    toAi: message.kind === 'ask_ai',
    exchangeId: message.exchangeId,
    taskId: message.taskId,
    mention,
    sender: message.author === 'system' ? null : faceOf(state, message.authorAccountId),
    attachments: state.networkAttachments.forMessage(message.id),
    ...(marks === undefined || marks.length === 0 ? {} : { reactions: marks }),
    ...(reply === null ? {} : { replyTo: reply }),
  };
}

export function groupItemOf(state: StateService, message: GroupMessage, activity?: TaskActivity,
  execution?: TaskExecution, reactions?: ReadonlyMap<string, ReactionView[]>):
  ContactThreadItem | null {
  if (message.kind === 'task') {
    const task = message.taskId === null ? undefined : state.groupTasks.get(message.taskId);
    return task === undefined ? null : { type: 'group_task', at: message.sentAt,
      task: groupTaskView(state, task, activity, execution) };
  }
  return { type: 'message', message: groupMessageView(state, message, reactions) };
}

export function groupThread(state: StateService, groupId: string, before: string | undefined,
  activity?: TaskActivity, execution?: TaskExecution):
  { items: ContactThreadItem[]; hasMore: boolean } {
  const page = state.groupMessages.page(groupId, before, CONTACT_MESSAGES_PAGE).reverse();
  const oldest = page[0];
  const hasMore = oldest !== undefined && state.groupMessages.page(groupId, oldest.sentAt, 1).length > 0;
  const reactions = foldReactions(state.contactMessages.groupReactions(groupId));
  return { items: page.map((message) => groupItemOf(state, message, activity, execution, reactions))
    .filter((item) => item !== null), hasMore };
}
