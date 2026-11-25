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

export const SYSTEM_SOURCES = {
  patrol: '巡查',
  feedback: '反馈',
  'cyber-hunter': 'Cyber Hunter',
  interview: '采访',
} as const;
export type SystemSource = keyof typeof SYSTEM_SOURCES;

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
  entries: PersonEntry[];
  said: SaidEntry[];
  safetyCode: string;
  safetyChanged: boolean;
  suggestion: string | null;
  avatar?: string | null;
  alias?: string | null;
  removedAt?: string | null;
  aiName?: string | null;
  personDocId?: string | null;
  linkDismissed?: boolean;
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
    name: record.alias ?? record.name,
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
    aiName: record.aiName ?? null,
    removedAt: record.removedAt ?? null,
  };
}

function firstSentence(text: string): string {
  const sentence = text.split(/[。！？!?\n]/)[0] ?? text;
  return Array.from(sentence).slice(0, SUMMARY_MAX_CHARS).join('');
}

function isAi(message: ContactMessageView): boolean {
  return message.author === 'my_ai' || message.author === 'their_ai';
}

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

export interface SourceGroup {
  id: string;
  kind: 'mail' | 'system';
  name: string;
  address: string;
  messages: InboxMessageView[];
}

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
