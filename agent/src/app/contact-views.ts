// 网络上的人 → 接口视图（shared/api/contacts.ts）：列表的一行、聊天里的一项、任务卡、资料。只挑字段和拼接；
// 同一段 AI↔AI 沟通里连着的 AI 消息在这里收成一项 exchange（摘要 = 最后一条 AI 消息的第一句，≤ 30 字）。
// 钥匙只给安全码用：私钥从不进视图。

import {
  CONTACT_MESSAGES_PAGE,
  type ContactDetail,
  type ContactMessageView,
  type ContactRow,
  type ContactThreadItem,
  type DeliveryEntry,
  type NetworkTaskView,
  type NetworkTaskExecution,
  type SaidEntry,
} from '../../shared/api/index.ts';
import { TIERS, type Tier } from '../../shared/api/visibility.ts';
import type { Contact, ContactMessage, NetworkTask, SaidLog } from '../../shared/state.ts';
import { safetyCode, taskStage, taskWaiting } from '../network/index.ts';
import { contactMessageKey, foldReactions, type ReactionView } from '../network/contact-edits.ts';
import { contactMemory } from './contact-memory-view.ts';
import type { StateService } from '../state/index.ts';

/** 资料栏「代你说过」最近 20 条（规格第 6 节）。 */
export const SAID_SHOWN = 20;
const SUMMARY_CHARS = 30;
const AI_AUTHORS = new Set(['my_ai', 'their_ai']);
// 任务的回音（表态、交付、验收）都画在任务卡上，不单独成一句。
const TASK_ECHOES = new Set(['task_reply', 'task_delivery', 'task_verdict']);

/** 一对一聊天里两边的名字（@ 谁的 Plasticine 用）。 */
export interface ChatNames {
  mine: string;
  theirs: string;
}

/** 这句 @ 了谁的 Plasticine：问对方的（ask_ai）、@ 自己的（text 带 toOwnAi）。 */
function mentionOf(message: ContactMessage, names: ChatNames | undefined): { name: string; self: boolean } | null {
  if (names === undefined) {
    return null;
  }
  const out = message.direction === 'out';
  if (message.kind === 'ask_ai' && message.payload?.['fromAi'] !== true) {
    return out ? { name: names.theirs, self: false } : { name: names.mine, self: true };
  }
  if (message.kind === 'text' && message.payload?.['toOwnAi'] === true) {
    return out ? { name: names.mine, self: true } : { name: names.theirs, self: false };
  }
  return null;
}

/** 回的那一句：一对一按信封 id 找；谁说的写名字（我写「我」）。 */
function replyOf(state: StateService, message: ContactMessage, names: ChatNames | undefined):
  { author: string; text: string } | null {
  const key = message.kind === 'text' ? message.payload?.['replyTo'] : undefined;
  const target = typeof key === 'string' ? state.contactMessages.byEnvelope(key) : undefined;
  if (target === undefined) return null;
  return { author: target.direction === 'out' ? '我' : names?.theirs ?? '对方', text: target.text.slice(0, 80) };
}

export function messageView(message: ContactMessage, names?: ChatNames, state?: StateService,
  reactions?: ReadonlyMap<string, ReactionView[]>): ContactMessageView {
  const key = contactMessageKey(message);
  const marks = key === null ? undefined : reactions?.get(key);
  const reply = state === undefined ? null : replyOf(state, message, names);
  return {
    id: message.id,
    author: message.author,
    text: message.text,
    at: message.sentAt,
    status: message.status,
    toAi: message.kind === 'ask_ai',
    exchangeId: message.exchangeId,
    taskId: message.taskId,
    mention: mentionOf(message, names),
    ...(state === undefined ? {} : { attachments: state.networkAttachments.forMessage(message.id) }),
    ...(message.error === null ? {} : { error: message.error }),
    ...(marks === undefined || marks.length === 0 ? {} : { reactions: marks }),
    ...(reply === null ? {} : { replyTo: reply }),
  };
}

export function chatNames(state: StateService, contactId: string): ChatNames | undefined {
  const identity = state.networkIdentity.get();
  const contact = state.contacts.get(contactId);
  return identity === undefined || contact === undefined ? undefined
    : { mine: identity.displayName, theirs: contact.alias ?? contact.displayName };
}

export type TaskActivity = (task: NetworkTask) => { text: string; since: string } | null;
export type TaskExecution = (task: NetworkTask) => NetworkTaskExecution | null;

export function networkTaskView(task: NetworkTask, activity?: TaskActivity, execution?: TaskExecution):
  NetworkTaskView {
  return {
    id: task.id,
    direction: task.direction,
    contactId: task.contactId,
    title: task.title,
    goal: task.goal,
    acceptance: task.acceptance,
    deadline: task.deadline,
    state: task.state,
    doer: task.doer,
    stage: taskStage(task.state),
    waiting: taskWaiting(task),
    delivery: task.deliveryText === null || task.deliveryAt === null ? null
      : { text: task.deliveryText, at: task.deliveryAt },
    verdict: task.verdict === null || task.verdictAt === null ? null
      : { verdict: task.verdict, note: task.verdictNote ?? '', at: task.verdictAt },
    localTaskId: task.localTaskId,
    revisionAskId: task.direction === 'in' && task.state === 'rejected' && task.doer === 'ai' ? task.askId : null,
    execution: execution?.(task) ?? null,
    activity: activity?.(task) ?? null,
    attachment: task.attachment,
    decidedAt: task.decidedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    version: task.version,
  };
}

/** 分身拿不准、等我确认怎么回的卡，还开着的。 */
function openReplyCards(state: StateService, contactId: string): number {
  return state.asks.open().filter((ask) => ask.purpose === 'network_reply'
    && ask.context?.['contactId'] === contactId).length;
}

/** 列表里看不见的：「先不理」的请求。 */
export function listed(contact: Contact): boolean {
  return !(contact.state === 'request' && contact.ignoredAt !== null);
}

export function personRow(state: StateService, contact: Contact): ContactRow {
  const last = state.contactMessages.latest(contact.id);
  const waitingTask = state.networkTasks.forContact(contact.id).some(taskWaiting);
  return {
    id: contact.id,
    kind: 'person',
    name: contact.alias ?? contact.displayName,
    handle: contact.handle,
    address: null,
    relation: contact.relation,
    state: contact.state,
    last: last === undefined ? null : { text: last.text, at: last.sentAt, author: last.author },
    unread: state.contactMessages.unreadCount(contact.id),
    waiting: contact.state === 'request' || waitingTask || openReplyCards(state, contact.id) > 0,
    canSend: contact.state !== 'blocked' && !contact.safetyChanged,
    version: contact.version,
    avatar: contact.avatar,
    aiName: contact.aiName,
    removedAt: contact.removedAt,
  };
}

function firstSentence(text: string): string {
  const sentence = /^[^。！？!?\n]*[。！？!?]?/.exec(text.trim())?.[0] ?? text;
  const chars = Array.from(sentence.trim());
  return chars.length <= SUMMARY_CHARS ? chars.join('') : `${chars.slice(0, SUMMARY_CHARS - 1).join('')}…`;
}

function exchangeOf(run: readonly ContactMessageView[]): ContactThreadItem {
  const last = run[run.length - 1] as ContactMessageView;
  return { type: 'exchange', id: last.exchangeId ?? last.id, at: last.at, count: run.length,
    summary: firstSentence(last.text), messages: [...run] };
}

/**
 * AI↔AI：同一个 exchangeId、连着的 AI 消息（两条起）收成一项；其余原样。只收有 AI 发问的那几段——人问对方的
 * Plasticine、它先说「我问一下主人」再回答，是人和 AI 的对话，照常一句一句摆。
 */
export function foldExchanges(items: readonly ContactThreadItem[], aiExchanges: ReadonlySet<string>):
  ContactThreadItem[] {
  const folded: ContactThreadItem[] = [];
  let run: ContactMessageView[] = [];
  const flush = (): void => {
    if (run.length >= 2) {
      folded.push(exchangeOf(run));
    } else {
      folded.push(...run.map((message): ContactThreadItem => ({ type: 'message', message })));
    }
    run = [];
  };
  for (const item of items) {
    const ai = item.type === 'message' && AI_AUTHORS.has(item.message.author) && item.message.exchangeId !== null
      && aiExchanges.has(item.message.exchangeId) ? item.message : null;
    if (ai !== null && (run.length === 0 || run[0]?.exchangeId === ai.exchangeId)) {
      run.push(ai);
      continue;
    }
    flush();
    if (ai === null) {
      folded.push(item);
    } else {
      run.push(ai);
    }
  }
  flush();
  return folded;
}

function itemOf(state: StateService, message: ContactMessage, activity?: TaskActivity, execution?: TaskExecution,
  reactions?: ReadonlyMap<string, ReactionView[]>): ContactThreadItem | null {
  if (TASK_ECHOES.has(message.kind)) {
    return null;
  }
  if (message.kind === 'task_offer' && message.taskId !== null) {
    const task = state.networkTasks.get(message.taskId);
    return task === undefined ? null : { type: 'task', at: message.sentAt,
      task: networkTaskView(task, activity, execution) };
  }
  return { type: 'message', message: messageView(message, chatNames(state, message.contactId), state, reactions) };
}

/** 有 AI 发问的那几段沟通：对方或我的 Plasticine 自己问的（ask_ai 的 fromAi、ai_text 的 askerIsAi）。 */
function aiExchangesOf(messages: readonly ContactMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    const asked = message.kind === 'ask_ai' && message.payload?.['fromAi'] === true;
    const answered = message.kind === 'ai_text' && message.payload?.['askerIsAi'] === true;
    if ((asked || answered) && message.exchangeId !== null) {
      ids.add(message.exchangeId);
    }
  }
  return ids;
}

export interface PersonThread {
  items: ContactThreadItem[];
  hasMore: boolean;
}

/** 一页聊天（旧的在前），`before` 往上翻。 */
export function personThread(state: StateService, contactId: string, before: string | undefined,
  activity?: TaskActivity, execution?: TaskExecution): PersonThread {
  const page = state.contactMessages.page(contactId, before, CONTACT_MESSAGES_PAGE).reverse();
  const oldest = page[0];
  const hasMore = oldest !== undefined && state.contactMessages.page(contactId, oldest.sentAt, 1).length > 0;
  const reactions = foldReactions(state.contactMessages.reactions(contactId));
  const items = page.map((message) => itemOf(state, message, activity, execution, reactions))
    .filter((item) => item !== null);
  return { items: foldExchanges(items, aiExchangesOf(page)), hasMore };
}

/** 一封信在聊天里是哪一项（推 contact_item 用）：任务的回音给任务卡，AI↔AI 给收起来的那一项。 */
export function threadItemFor(state: StateService, message: ContactMessage, activity?: TaskActivity,
  execution?: TaskExecution):
  ContactThreadItem | null {
  if (TASK_ECHOES.has(message.kind) || message.kind === 'task_offer') {
    const task = message.taskId === null ? undefined : state.networkTasks.get(message.taskId);
    const offered = task === undefined ? undefined : state.contactMessages.forTask(task.id)
      .find((row) => row.kind === 'task_offer');
    return task === undefined ? null : { type: 'task', at: offered?.sentAt ?? task.offeredAt,
      task: networkTaskView(task, activity, execution) };
  }
  const { items } = personThread(state, message.contactId, undefined);
  return items.find((item) => (item.type === 'message' && item.message.id === message.id)
    || (item.type === 'exchange' && item.messages.some((entry) => entry.id === message.id)))
    ?? itemOf(state, message);
}

function deliveryEntry(task: NetworkTask): DeliveryEntry {
  return { taskId: task.id, title: task.title, direction: task.direction, state: task.state, at: task.updatedAt };
}

/** 一句话用到的材料里最私的那一档（这句话最深说到哪一层）；没用材料算公开。 */
function saidTier(entry: SaidLog): Tier {
  const used = entry.materials.map((material) => TIERS.indexOf(material.tier));
  return used.length === 0 ? 'public' : TIERS[Math.max(...used)] ?? 'public';
}

function saidEntry(entry: SaidLog): SaidEntry {
  return { id: entry.id, text: entry.text, tier: saidTier(entry), at: entry.at };
}

export function personDetail(state: StateService, contact: Contact): ContactDetail {
  const identity = state.networkIdentity.get();
  return {
    contact: personRow(state, contact),
    memory: contactMemory(state, contact),
    tierCap: contact.tierCap,
    deliveries: state.networkTasks.forContact(contact.id).map(deliveryEntry),
    said: state.saidLog.recent(contact.id, SAID_SHOWN).map(saidEntry),
    safetyCode: identity === undefined ? null : safetyCode(
      { accountId: identity.accountId, signingKey: identity.signingPublicKey },
      { accountId: contact.accountId, signingKey: contact.signingKey }),
    safetyChanged: contact.safetyChanged,
  };
}
