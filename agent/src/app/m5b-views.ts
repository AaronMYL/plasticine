// M5 乙路的接口视图：库里的行 → shared/api 里的形状。只取界面要的字段；legacy_payload 从不出去；凭据、服务器原文本来就
// 不在行里。

import {
  INBOX_BOX_LABELS,
  type FileEntryView,
  type InboxMessageView,
  type InboxReplyView,
  type InboxRowView,
  type MoneyAccountView,
  type MoneyEntryView,
  type ToolGroupDefinition,
  type ToolGroupView,
  type TrashEntryView,
} from '../../shared/api/index.ts';
import type { InboxMessage, InboxReply, MoneyEntry, ToolGroup } from '../../shared/state.ts';
import type { TrashEntry, WorkspaceEntry } from '../artifacts/index.ts';
import { previewOf } from '../daily/index.ts';
import type { AccountBalance } from '../life/index.ts';
import type { StateService } from '../state/index.ts';

const REPLY_STATUS_LABELS: Readonly<Record<InboxReply['status'], string>> = {
  stored: '记下了',
  sending: '正在发',
  sent: '发出去了',
  dry_run: '干跑：记下了，没有发',
  failed: '没发出去',
  unknown: '结果待核实',
};

export function moneyEntryView(state: StateService, entry: MoneyEntry): MoneyEntryView {
  const category = entry.categoryId === null ? undefined : state.moneyCategories.get(entry.categoryId);
  return {
    id: entry.id,
    kind: entry.kind,
    amountCents: entry.amountCents,
    currency: entry.currency,
    cnyCents: entry.cnyCents,
    categoryId: entry.categoryId,
    categoryName: category?.name ?? null,
    accountId: entry.accountId,
    toAccountId: entry.toAccountId,
    merchant: entry.merchant,
    note: entry.note,
    occurredAt: entry.occurredAt,
    discountCents: entry.discountCents,
    feeCents: entry.feeCents,
    origin: entry.origin,
    confidence: entry.confidence,
    review: entry.review,
    deleted: entry.deletedAt !== null,
    migrated: entry.migratedDefault,
    version: entry.version,
  };
}

export function moneyAccountView(row: AccountBalance): MoneyAccountView {
  const { account } = row;
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    openingCents: account.openingCents,
    excluded: account.excluded,
    note: account.note,
    balanceCents: row.balanceCents,
    version: account.version,
  };
}

export function inboxRowView(message: InboxMessage): InboxRowView {
  return {
    id: message.id,
    source: message.source,
    sourceLabel: INBOX_BOX_LABELS[message.source],
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    title: message.title,
    preview: previewOf(message.body),
    receivedAt: message.receivedAt,
    read: message.readAt !== null,
    starred: message.starredAt !== null,
    archived: message.archivedAt !== null,
    act: message.act,
    attachments: message.attachments,
    migrated: message.migratedDefault,
    version: message.version,
  };
}

export function inboxReplyView(reply: InboxReply): InboxReplyView {
  return {
    id: reply.id,
    text: reply.text,
    status: reply.status,
    statusLabel: REPLY_STATUS_LABELS[reply.status],
    createdAt: reply.createdAt,
    sentAt: reply.sentAt,
    error: reply.error,
    version: reply.version,
  };
}

export function inboxMessageView(message: InboxMessage, replies: readonly InboxReply[]): InboxMessageView {
  return {
    ...inboxRowView(message),
    body: message.body,
    toAddress: message.toAddress,
    replies: replies.map(inboxReplyView),
    replySends: message.source === 'email',
  };
}

export function toolGroupView(definition: ToolGroupDefinition, row: ToolGroup | undefined): ToolGroupView {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    tools: [...definition.tools],
    enabled: row?.enabled ?? definition.defaultEnabled,
    version: row?.version ?? 0,
    confirmedAt: row?.confirmedByDeviceAt ?? null,
  };
}

export function fileEntryView(entry: WorkspaceEntry): FileEntryView {
  return { ...entry };
}

export function trashEntryView(entry: TrashEntry): TrashEntryView {
  return { ...entry };
}
