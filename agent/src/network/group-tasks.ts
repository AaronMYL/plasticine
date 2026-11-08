// 群里的任务卡（2026-11-05 他定）：发给群里指定的一个人，或全群「谁先接谁做」；卡上「我来接」「让 Plasticine 接」。
// 谁先接到由发起人那台定：认领（task_claim）发给发起人，发起人按收到的先后认第一个，把「谁接到了」发给每个成员；
// 后来的认领不算（他们收到的那封写着别人接了）。接下以后，发起人和接的人之间照常走一对一的任务（network_tasks，
// 带 group_id 画在群里）：交付、收到 / 再改改都和一对一一样；发起人每变一步把进度发给群里每个人。

import type { Plaintext } from '../../shared/net-wire.ts';
import type { Contact, Group, GroupTask, GroupTaskState, NetworkTask } from '../../shared/state.ts';
import type { Changes } from '../attention/index.ts';
import { requireIdentity, type NetworkContext } from './context.ts';
import { NetworkError } from './errors.ts';
import { afterGroup, requireGroup } from './groups.ts';
import { enqueue } from './outbox.ts';
import { openLocalLine, raiseDeliverCard } from './tasks.ts';

export interface GroupTaskInput {
  title: string;
  goal: string;
  deadline: string | null;
  attachment: string | null;
  /** 指给谁（账号 id）；null = 全群谁先接谁做。 */
  assignee: string | null;
  requestId: string;
}

type Doer = 'ai' | 'person';

const STATE_OF: Readonly<Record<NetworkTask['state'], GroupTaskState>> = {
  offered: 'claimed', accepted: 'claimed', in_progress: 'in_progress', delivered: 'delivered', passed: 'passed',
  rejected: 'rejected', declined: 'declined', cancelled: 'cancelled',
};

function payloadOf(task: GroupTask, op: Plaintext<'group_task'>['op']): Plaintext<'group_task'> {
  return { groupId: task.groupId, taskId: task.id, op, title: task.title, goal: task.goal, deadline: task.deadline,
    attachment: task.attachment, assignee: task.assigneeAccountId, claimer: task.claimerAccountId, doer: task.doer,
    state: task.state };
}

/** 发起人把卡的现状发给群里别的每个人。 */
function broadcast(context: NetworkContext, group: Group, task: GroupTask, op: Plaintext<'group_task'>['op']): void {
  const me = requireIdentity(context).accountId;
  const payload = payloadOf(task, op);
  for (const member of context.state.groupMembers.current(group.id)) {
    const contact = member.accountId === me ? undefined : context.state.contacts.byAccount(member.accountId);
    if (contact !== undefined && contact.state !== 'blocked') {
      enqueue(context, contact, { kind: 'group_task', author: 'me', text: task.title, payload, taskId: task.id,
        groupId: group.id });
    }
  }
}

function place(context: NetworkContext, group: Group, task: GroupTask, author: string, mine: boolean): string {
  const at = context.now().toISOString();
  const message = context.state.groupMessages.create({ groupId: group.id, messageId: `task-${task.id}`,
    authorAccountId: author, author: mine ? 'me' : 'them', kind: 'task', text: task.title, taskId: task.id,
    sentAt: at, ...(mine ? { readAt: at } : {}) });
  const current = context.state.groups.require(group.id);
  context.state.groups.update(current.id, current.version, { lastAt: at });
  return message.id;
}

/** 在群里发一张任务卡（指给某人，或全群谁先接谁做）。 */
export function offerGroupTask(context: NetworkContext, groupId: string, input: GroupTaskInput): GroupTask {
  const identity = requireIdentity(context);
  const earlier = context.state.groupTasks.byRequest(input.requestId);
  if (earlier !== undefined) {
    return earlier;
  }
  const group = requireGroup(context, groupId);
  if (input.assignee !== null && (input.assignee === identity.accountId
    || context.state.groupMembers.get(group.id, input.assignee)?.leftAt !== null)) {
    throw new NetworkError('invalid_input', '只能指给群里别的人。', 'assignee');
  }
  return context.desk.commit((changes) => {
    const task = context.state.groupTasks.create(context.newId(), { groupId: group.id,
      ownerAccountId: identity.accountId, assigneeAccountId: input.assignee, title: input.title, goal: input.goal,
      deadline: input.deadline, attachment: input.attachment, state: 'open', offeredAt: context.now().toISOString(),
      requestId: input.requestId });
    const messageId = place(context, group, task, identity.accountId, true);
    broadcast(context, group, task, 'offer');
    afterGroup(context, changes, group.id, [messageId], [task.id]);
    return task;
  });
}

/** 我来接 / 让 Plasticine 接：认领发给发起人，等它定；本机先记下「我在接」。 */
export function claimGroupTask(context: NetworkContext, taskId: string, doer: Doer): GroupTask {
  const identity = requireIdentity(context);
  const task = requireGroupTask(context, taskId);
  const group = requireGroup(context, task.groupId);
  if (task.ownerAccountId === identity.accountId) {
    throw new NetworkError('invalid_input', '自己发的卡不用接。');
  }
  if (task.state !== 'open') {
    throw new NetworkError('conflict', '这张卡已经有人接了。');
  }
  if (task.assigneeAccountId !== null && task.assigneeAccountId !== identity.accountId) {
    throw new NetworkError('conflict', '这张卡指给了别人。');
  }
  const owner = context.state.contacts.byAccount(task.ownerAccountId);
  if (owner === undefined) {
    throw new NetworkError('not_found', '找不到发卡的人。');
  }
  return context.desk.commit((changes) => {
    const claimed = context.state.groupTasks.update(task.id, task.version, { claimerAccountId: identity.accountId,
      doer });
    enqueue(context, owner, { kind: 'task_claim', author: 'me', text: task.title,
      payload: { groupId: group.id, taskId: task.id, doer }, taskId: task.id, groupId: group.id });
    afterGroup(context, changes, group.id, [], [task.id]);
    return claimed;
  });
}

/** 发起人撤回一张还没人接的卡。 */
export function cancelGroupTask(context: NetworkContext, taskId: string): GroupTask {
  const identity = requireIdentity(context);
  const task = requireGroupTask(context, taskId);
  if (task.ownerAccountId !== identity.accountId) {
    throw new NetworkError('invalid_input', '只有发卡的人能撤回。');
  }
  if (task.state !== 'open') {
    throw new NetworkError('conflict', '已经有人接了，撤不回。');
  }
  const group = requireGroup(context, task.groupId);
  return context.desk.commit((changes) => {
    const cancelled = context.state.groupTasks.update(task.id, task.version, { state: 'cancelled' });
    broadcast(context, group, cancelled, 'cancel');
    afterGroup(context, changes, group.id, [], [task.id]);
    return cancelled;
  });
}

function requireGroupTask(context: NetworkContext, taskId: string): GroupTask {
  const task = context.state.groupTasks.get(taskId);
  if (task === undefined) {
    throw new NetworkError('not_found', '没有这张任务卡。');
  }
  return task;
}

// ---------- 发起人那台：定谁接到 ----------

/** 收到认领：还没人接、指给的就是他（或全群）→ 他接到；之后来的不算。返回改了的群卡。 */
export function receiveClaim(context: NetworkContext, changes: Changes, sender: Contact,
  payload: Plaintext<'task_claim'>): GroupTask | null {
  const identity = requireIdentity(context);
  const task = context.state.groupTasks.get(payload.taskId);
  if (task === undefined || task.ownerAccountId !== identity.accountId || task.groupId !== payload.groupId
    || task.state !== 'open' || context.state.groupMembers.get(task.groupId, sender.accountId)?.leftAt !== null
    || (task.assigneeAccountId !== null && task.assigneeAccountId !== sender.accountId)) {
    return null;
  }
  const group = context.state.groups.require(task.groupId);
  const at = context.now().toISOString();
  const claimed = context.state.groupTasks.update(task.id, task.version, {
    state: payload.doer === 'ai' ? 'in_progress' : 'claimed', claimerAccountId: sender.accountId,
    doer: payload.doer, claimedAt: at });
  context.state.networkTasks.create(task.id, { direction: 'out', contactId: sender.id, title: task.title,
    goal: task.goal, acceptance: task.goal, deadline: task.deadline, attachment: task.attachment,
    state: payload.doer === 'ai' ? 'in_progress' : 'accepted', offeredAt: task.offeredAt, groupId: group.id });
  const pair = context.state.networkTasks.require(task.id);
  context.state.networkTasks.update(pair.id, pair.version, { doer: payload.doer, decidedAt: at });
  broadcast(context, group, claimed, 'claimed');
  afterGroup(context, changes, group.id, [], [task.id]);
  return claimed;
}

/** 发起人这边那条一对一任务变了（对方交付了、我收到 / 再改改）：群卡跟着变，进度发给每个人。 */
export function syncGroupTask(context: NetworkContext, changes: Changes, task: NetworkTask): void {
  if (task.groupId === null) {
    return;
  }
  const card = context.state.groupTasks.get(task.id);
  const group = context.state.groups.get(task.groupId);
  if (card === undefined || group === undefined) {
    return;
  }
  const state = STATE_OF[task.state];
  if (card.state === state) {
    return;
  }
  const updated = context.state.groupTasks.update(card.id, card.version, { state });
  if (task.direction === 'out' && group.leftAt === null) {
    broadcast(context, group, updated, 'state');
  }
  afterGroup(context, changes, group.id, [], [card.id]);
}

// ---------- 群里每个人：收到卡和进度 ----------

/** 收到发起人发来的卡、谁接到了、进度、撤回。是我接到了就在本机开始做（让 Plasticine 接 = 开一条线）。 */
export function receiveGroupTask(context: NetworkContext, changes: Changes, sender: Contact,
  payload: Plaintext<'group_task'>): { groupId: string; messageIds: string[]; taskId: string } | null {
  const identity = requireIdentity(context);
  const { state } = context;
  const group = state.groups.get(payload.groupId);
  if (group === undefined || group.leftAt !== null
    || state.groupMembers.get(group.id, sender.accountId)?.leftAt !== null) {
    return null;
  }
  let card = state.groupTasks.get(payload.taskId);
  const messageIds: string[] = [];
  if (card === undefined) {
    if (payload.op !== 'offer') {
      return null;
    }
    card = state.groupTasks.create(payload.taskId, { groupId: group.id, ownerAccountId: sender.accountId,
      assigneeAccountId: payload.assignee, title: payload.title, goal: payload.goal, deadline: payload.deadline,
      attachment: payload.attachment, state: 'open', offeredAt: context.now().toISOString() });
    messageIds.push(place(context, group, card, sender.accountId, false));
    return { groupId: group.id, messageIds, taskId: card.id };
  }
  if (card.ownerAccountId !== sender.accountId) {
    return null;
  }
  const mineBefore = card.claimerAccountId === identity.accountId;
  card = state.groupTasks.update(card.id, card.version, { state: payload.state,
    claimerAccountId: payload.claimer, doer: payload.doer,
    ...(payload.op === 'claimed' ? { claimedAt: context.now().toISOString() } : {}) });
  if (payload.op === 'claimed' && payload.claimer === identity.accountId) {
    startClaimed(context, changes, card, sender);
  } else if (payload.op === 'claimed' && mineBefore) {
    messageIds.push(state.groupMessages.create({ groupId: group.id, messageId: `lost-${card.id}`,
      authorAccountId: identity.accountId, author: 'system', kind: 'system',
      text: `「${card.title}」别人先接了。`, sentAt: context.now().toISOString(),
      readAt: context.now().toISOString() }).id);
  }
  return { groupId: group.id, messageIds, taskId: card.id };
}

/** 我接到了：本机记一条一对一任务（对方是发起人），让 Plasticine 接就开一条线去做，我来接就出交付卡。 */
function startClaimed(context: NetworkContext, changes: Changes, card: GroupTask, owner: Contact): void {
  const { state } = context;
  if (state.networkTasks.get(card.id) !== undefined) {
    return;
  }
  const doer: Doer = card.doer ?? 'person';
  const at = context.now().toISOString();
  let task = state.networkTasks.create(card.id, { direction: 'in', contactId: owner.id, title: card.title,
    goal: card.goal, acceptance: card.goal, deadline: card.deadline, attachment: card.attachment,
    state: doer === 'ai' ? 'in_progress' : 'accepted', offeredAt: card.offeredAt, groupId: card.groupId });
  if (doer === 'ai') {
    const lineId = openLocalLine(context, changes, task, owner);
    task = state.networkTasks.update(task.id, task.version, { doer, decidedAt: at, localTaskId: lineId });
  } else {
    task = state.networkTasks.update(task.id, task.version, { doer, decidedAt: at });
    raiseDeliverCard(context, changes, task);
  }
}
