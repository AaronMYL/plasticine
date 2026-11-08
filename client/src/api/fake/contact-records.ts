// 假联系人的记录和由记录算出的界面形状（照规格第 6 节服务端的做法）：一行联系人（最后一句、未读、等你）、一段聊天
// （同一段 AI↔AI 沟通收成一项 exchange）、资料（交付记录、代你说过）。邮件和系统来源不另存，从假站内信里按发件地址 /
// 来源归并出来；Plasticine 自己的通知不进联系人（进「设置 · 通知记录」）。这里只有纯函数，读写和事件在 fake-contacts.ts。

import {
  CONTACT_MESSAGES_PAGE,
  type ContactDetail,
  type ContactMessageView,
  type ContactRelation,
  type ContactRow,
  type ContactState,
  type ContactThreadItem,
  type InboxMessageView,
  type NetworkTaskView,
  type SaidEntry,
} from '../shared.ts';

/** 联系人里的系统来源（只读）：巡查、反馈、Cyber Hunter、采访。 */
export const SYSTEM_SOURCES = {
  patrol: '巡查',
  feedback: '反馈',
  'cyber-hunter': 'Cyber Hunter',
  interview: '采访',
} as const;
export type SystemSource = keyof typeof SYSTEM_SOURCES;

/** exchange 的摘要最多这么多字（规格第 6 节：最后一条 AI 消息的第一句，≤ 30 字）。 */
const SUMMARY_MAX_CHARS = 30;

export interface PersonRecord {
  id: string;
  name: string;
  handle: string;
  relation: ContactRelation;
  state: ContactState;
  unread: number;
  version: number;
  tierCap: string | null;
  /** 按时间先后：一句话，或一张任务卡（任务本身在 tasks 里，按 id 引用）。 */
  entries: PersonEntry[];
  said: SaidEntry[];
  safetyCode: string;
  safetyChanged: boolean;
  suggestion: string | null;
  /** 对方发来的头像（data URL）；没有画名字首字。 */
  avatar?: string | null;
}

export type PersonEntry = { type: 'message'; message: ContactMessageView } | { type: 'task'; taskId: string };

export function mailContactId(address: string): string {
  return `mail:${address}`;
}

export function systemContactId(source: SystemSource): string {
  return `system:${source}`;
}

export function isSystemSource(source: string): source is SystemSource {
  return source in SYSTEM_SOURCES;
}

/** 这条任务现在等不等我：对方发来待表态、我来做的该交付、对方交付了待我验收。 */
export function taskWaiting(task: Pick<NetworkTaskView, 'direction' | 'state' | 'doer'>): boolean {
  if (task.direction === 'in') {
    return task.state === 'offered' || (task.state === 'in_progress' && task.doer === 'person');
  }
  return task.state === 'delivered';
}

const TASK_PREVIEW_SUFFIX: Partial<Record<NetworkTaskView['state'], string>> = {
  passed: '通过',
  rejected: '退回',
  declined: '先不',
  cancelled: '取消',
};

function entryAt(entry: PersonEntry, tasks: ReadonlyMap<string, NetworkTaskView>): string {
  return entry.type === 'message' ? entry.message.at : tasks.get(entry.taskId)?.createdAt ?? '';
}

function personPreview(record: PersonRecord, tasks: ReadonlyMap<string, NetworkTaskView>): ContactRow['last'] {
  const last = record.entries.at(-1);
  if (last === undefined) {
    return null;
  }
  if (last.type === 'message') {
    return { text: last.message.text, at: last.message.at, author: last.message.author };
  }
  const task = tasks.get(last.taskId);
  if (task === undefined) {
    return null;
  }
  const suffix = TASK_PREVIEW_SUFFIX[task.state];
  return {
    text: suffix === undefined ? task.title : `${task.title} · ${suffix}`,
    at: task.updatedAt,
    author: task.direction === 'out' ? 'me' : 'them',
  };
}

export function personRow(record: PersonRecord, tasks: ReadonlyMap<string, NetworkTaskView>): ContactRow {
  const own = [...tasks.values()].filter((task) => task.contactId === record.id);
  return {
    id: record.id,
    kind: 'person',
    name: record.name,
    handle: record.handle,
    address: null,
    relation: record.relation,
    state: record.state,
    last: personPreview(record, tasks),
    unread: record.unread,
    waiting: record.state === 'request' || own.some(taskWaiting),
    canSend: record.state !== 'blocked',
    version: record.version,
    avatar: record.avatar ?? null,
  };
}

function firstSentence(text: string): string {
  const sentence = text.split(/[。！？!?\n]/)[0] ?? text;
  return Array.from(sentence).slice(0, SUMMARY_MAX_CHARS).join('');
}

function isAi(message: ContactMessageView): boolean {
  return message.author === 'my_ai' || message.author === 'their_ai';
}

/**
 * 同一个 exchangeId 的连续 AI 消息收成一项；只有两边的 AI 都说了话才算 AI↔AI（对方的 Plasticine 回我一句问话照常摊开）。
 */
function foldExchanges(items: ContactThreadItem[]): ContactThreadItem[] {
  const folded: ContactThreadItem[] = [];
  let run: ContactMessageView[] = [];
  const flush = (): void => {
    const sides = new Set(run.map((message) => message.author));
    const first = run[0];
    const last = run.at(-1);
    if (run.length >= 2 && sides.size === 2 && first !== undefined && last !== undefined
      && first.exchangeId !== null) {
      folded.push({
        type: 'exchange',
        id: first.exchangeId,
        at: first.at,
        count: run.length,
        summary: firstSentence(last.text),
        messages: run,
      });
    } else {
      folded.push(...run.map((message): ContactThreadItem => ({ type: 'message', message })));
    }
    run = [];
  };
  for (const item of items) {
    const message = item.type === 'message' ? item.message : null;
    const joins = message !== null && isAi(message) && message.exchangeId !== null
      && (run.length === 0 || run[0]?.exchangeId === message.exchangeId);
    if (!joins) {
      flush();
    }
    if (message !== null && isAi(message) && message.exchangeId !== null) {
      run.push(message);
    } else {
      folded.push(item);
    }
  }
  flush();
  return folded;
}

export function personItems(record: PersonRecord, tasks: ReadonlyMap<string, NetworkTaskView>): ContactThreadItem[] {
  const items = [...record.entries]
    .sort((a, b) => entryAt(a, tasks).localeCompare(entryAt(b, tasks)))
    .flatMap((entry): ContactThreadItem[] => {
      if (entry.type === 'message') {
        return [{ type: 'message', message: entry.message }];
      }
      const task = tasks.get(entry.taskId);
      return task === undefined ? [] : [{ type: 'task', at: task.createdAt, task }];
    });
  return foldExchanges(items);
}

export function itemAt(item: ContactThreadItem): string {
  return item.type === 'message' ? item.message.at : item.at;
}

/** 一页：before 之前的最后 50 项。 */
export function page(items: readonly ContactThreadItem[], before: string | undefined) {
  const earlier = before === undefined ? [...items] : items.filter((item) => itemAt(item) < before);
  const start = Math.max(0, earlier.length - CONTACT_MESSAGES_PAGE);
  return { items: earlier.slice(start), hasMore: start > 0 };
}

export function personDetail(record: PersonRecord, tasks: ReadonlyMap<string, NetworkTaskView>): ContactDetail {
  const deliveries = [...tasks.values()]
    .filter((task) => task.contactId === record.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      direction: task.direction,
      state: task.state,
      at: task.updatedAt,
    }));
  return {
    contact: personRow(record, tasks),
    tierCap: record.tierCap,
    deliveries,
    said: record.said,
    safetyCode: record.safetyCode,
    safetyChanged: record.safetyChanged,
  };
}

// ---------- 邮件和系统来源：从站内信归并 ----------

export interface SourceGroup {
  id: string;
  kind: 'mail' | 'system';
  name: string;
  address: string;
  messages: InboxMessageView[];
}

/** 站内信按发件地址（邮件）或来源（巡查、反馈…）归并；Plasticine 通知和归档的不进来。 */
export function sourceGroups(messages: readonly InboxMessageView[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  const sorted = [...messages].filter((message) => !message.archived)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const message of sorted) {
    let key: string | null = null;
    let group: Omit<SourceGroup, 'messages'> | null = null;
    if (message.source === 'email') {
      key = mailContactId(message.fromAddress);
      group = { id: key, kind: 'mail', name: message.fromName ?? message.fromAddress, address: message.fromAddress };
    } else if (isSystemSource(message.source)) {
      key = systemContactId(message.source);
      group = { id: key, kind: 'system', name: SYSTEM_SOURCES[message.source], address: message.source };
    }
    if (key === null || group === null) {
      continue;
    }
    const held = groups.get(key);
    groups.set(key, held === undefined ? { ...group, messages: [message] }
      : { ...held, name: group.name, messages: [...held.messages, message] });
  }
  return [...groups.values()];
}

const REPLY_STATUS: Readonly<Record<string, ContactMessageView['status']>> = {
  sending: 'sending',
  failed: 'failed',
};

function itemText(group: SourceGroup, message: SourceGroup['messages'][number]): string {
  if (group.kind === 'mail' || message.body === '') {
    return group.kind === 'mail' ? message.body : message.title;
  }
  return `${message.title}\n\n${message.body}`;
}

/** 一个来源的来往。邮件一封标题和正文分开给（html 是这封有没有 HTML 正文，假实现里另存）。 */
export function sourceItems(group: SourceGroup, html: ReadonlyMap<string, string> = new Map()): ContactThreadItem[] {
  const messages: ContactMessageView[] = group.messages.flatMap((message) => [
    {
      id: message.id,
      author: 'them' as const,
      text: itemText(group, message),
      at: message.receivedAt,
      status: 'sent' as const,
      toAi: false,
      exchangeId: null,
      taskId: null,
      ...(group.kind === 'mail' ? { mail: { subject: message.title, fromName: message.fromName,
        fromAddress: message.fromAddress, html: html.has(message.id), attachments: message.attachments } } : {}),
    },
    ...message.replies.map((reply) => ({
      id: reply.id,
      author: 'me' as const,
      text: reply.text,
      at: reply.createdAt,
      status: REPLY_STATUS[reply.status] ?? 'sent',
      toAi: false,
      exchangeId: null,
      taskId: null,
    })),
  ]);
  return messages.sort((a, b) => a.at.localeCompare(b.at)).map((message) => ({ type: 'message', message }));
}

export function sourceRow(group: SourceGroup): ContactRow {
  const items = sourceItems(group);
  const last = items.at(-1);
  const lastMessage = last?.type === 'message' ? last.message : null;
  const latest = group.messages.at(-1);
  const preview = lastMessage === null ? null : {
    text: lastMessage.author === 'them' && latest !== undefined ? latest.title : lastMessage.text,
    at: lastMessage.at,
    author: lastMessage.author,
  };
  return {
    id: group.id,
    kind: group.kind,
    name: group.name,
    handle: null,
    address: group.address,
    relation: null,
    state: 'active',
    last: preview,
    unread: group.messages.filter((message) => !message.read).length,
    waiting: false,
    canSend: group.kind === 'mail',
    version: Math.max(1, ...group.messages.map((message) => message.version)),
  };
}

export function sourceDetail(group: SourceGroup): ContactDetail {
  return { contact: sourceRow(group), tierCap: null, deliveries: [], said: [], safetyCode: null, safetyChanged: false };
}
