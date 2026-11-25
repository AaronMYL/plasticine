import type { ContactRow } from '../api/shared.ts';

export const MESSAGE_FILTERS = ['people', 'groups', 'mail', 'all'] as const;
export const DEFAULT_MESSAGE_FILTER: MessageFilter = 'people';
export type MessageFilter = (typeof MESSAGE_FILTERS)[number];

export const FILTER_LABELS: Readonly<Record<MessageFilter, string>> = {
  all: '全部',
  people: '联系人',
  groups: '群组',
  mail: '邮件',
};

function ownFilter(row: ContactRow): Exclude<MessageFilter, 'all'> | null {
  if (row.kind === 'person') {
    return 'people';
  }
  if (row.kind === 'group') {
    return 'groups';
  }
  return row.kind === 'mail' ? 'mail' : null;
}

export function listedContacts(rows: readonly ContactRow[]): ContactRow[] {
  const group = (row: ContactRow): number => (people(row) ? 0 : 1);
  return rows.filter((row) => row.state !== 'request' && row.state !== 'blocked')
    .sort((a, b) => group(a) - group(b) || (b.last?.at ?? '').localeCompare(a.last?.at ?? ''));
}

export function rowsFor(rows: readonly ContactRow[], filter: MessageFilter): ContactRow[] {
  const listed = listedContacts(rows);
  return filter === 'all' ? listed : listed.filter((row) => ownFilter(row) === filter);
}

export function showsRequests(filter: MessageFilter): boolean {
  return filter === 'all' || filter === 'people';
}

export function filterForContact(row: ContactRow): MessageFilter {
  return ownFilter(row) ?? 'all';
}

function people(row: ContactRow | undefined): boolean {
  return row?.kind === 'person' || row?.kind === 'group';
}

export function startsOtherGroup(rows: readonly ContactRow[], index: number): boolean {
  return index > 0 && !people(rows[index]) && people(rows[index - 1]);
}

export function contactInFilter(row: ContactRow, filter: MessageFilter): boolean {
  return rowsFor([row], filter).length > 0;
}
