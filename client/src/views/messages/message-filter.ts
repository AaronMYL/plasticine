// 消息第二栏的筛选（11-07 设计稿 Messages）：联系人 · 群组 · 邮件 · 全部。消息里不再放 Plasticine（它有自己的栏目），
// 「AI 建议」那一段去掉（建议在任务栏目里）；系统来源（采访、反馈、Cyber Hunter）只在「全部」里。每一段里人和群在前、
// 邮件和系统来源在后（中间一道线，不写段名），各自按最近一句排；请求和拉黑的不在列表里。

import type { ContactRow } from '../../api/shared.ts';

// 11-12 全量优化（Aaron 定）：顺序 联系人 · 群组 · 邮件 · 全部，打开先看联系人（邮件和系统来源不抢位置）。
export const MESSAGE_FILTERS = ['people', 'groups', 'mail', 'all'] as const;
export const DEFAULT_MESSAGE_FILTER: MessageFilter = 'people';
export type MessageFilter = (typeof MESSAGE_FILTERS)[number];

export const FILTER_LABELS: Readonly<Record<MessageFilter, string>> = {
  all: '全部',
  people: '联系人',
  groups: '群组',
  mail: '邮件',
};

/** 这一行属于哪一段（除了「全部」）；只在「全部」里的是 null。 */
function ownFilter(row: ContactRow): Exclude<MessageFilter, 'all'> | null {
  if (row.kind === 'person') {
    return 'people';
  }
  if (row.kind === 'group') {
    return 'groups';
  }
  return row.kind === 'mail' ? 'mail' : null;
}

/** 列表里摆哪些、怎么排：人在前，邮件和系统来源在后，各自按最近一句排；新请求进置顶那一行，拉黑的不摆。 */
export function listedContacts(rows: readonly ContactRow[]): ContactRow[] {
  const group = (row: ContactRow): number => (people(row) ? 0 : 1);
  return rows.filter((row) => row.state !== 'request' && row.state !== 'blocked')
    .sort((a, b) => group(a) - group(b) || (b.last?.at ?? '').localeCompare(a.last?.at ?? ''));
}

export function rowsFor(rows: readonly ContactRow[], filter: MessageFilter): ContactRow[] {
  const listed = listedContacts(rows);
  return filter === 'all' ? listed : listed.filter((row) => ownFilter(row) === filter);
}

/** 新请求那一行在哪几段里：全部和人。 */
export function showsRequests(filter: MessageFilter): boolean {
  return filter === 'all' || filter === 'people';
}

/** 打开的那一条不在当前筛选里时换到哪一段（旧链接直接打开一封邮件、一类建议）。 */
export function filterForContact(row: ContactRow): MessageFilter {
  return ownFilter(row) ?? 'all';
}

/** 人和群（2026-11-05）算一段：聊天的；邮件和系统来源是另一段。 */
function people(row: ContactRow | undefined): boolean {
  return row?.kind === 'person' || row?.kind === 'group';
}

/** 人和邮件两段之间那一道线画在后一段第一行上面；只有一段时不画。 */
export function startsOtherGroup(rows: readonly ContactRow[], index: number): boolean {
  return index > 0 && !people(rows[index]) && people(rows[index - 1]);
}

/** 这一条在不在这一段的列表里（请求和拉黑的哪一段都不在）。 */
export function contactInFilter(row: ContactRow, filter: MessageFilter): boolean {
  return rowsFor([row], filter).length > 0;
}
