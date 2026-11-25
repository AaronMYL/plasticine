import { describe, expect, it } from 'vitest';
import type { ContactRow } from '../../../src/api/shared.ts';
import {
  FILTER_LABELS,
  DEFAULT_MESSAGE_FILTER,
  MESSAGE_FILTERS,
  filterForContact,
  listedContacts,
  rowsFor,
  showsRequests,
} from '../../../src/state/message-filter.ts';

function row(id: string, kind: ContactRow['kind'], at: string | null, fields: Partial<ContactRow> = {}): ContactRow {
  return { id, kind, name: id, handle: null, address: null, relation: null, state: 'active', unread: 0, waiting: false,
    canSend: true, version: 1, last: at === null ? null : { at, text: id, author: 'them' }, ...fields };
}

const ROWS: ContactRow[] = [
  row('mail:news@example.com', 'mail', '2026-11-04T01:00:00.000Z', { unread: 2 }),
  row('mail:bill@example.com', 'mail', '2026-11-04T04:00:00.000Z', { unread: 1 }),
  row('linyi', 'person', '2026-11-03T01:00:00.000Z', { unread: 4 }),
  row('system:patrol', 'system', '2026-11-04T02:00:00.000Z', { address: 'patrol', unread: 3 }),
  row('system:interview', 'system', '2026-11-04T02:30:00.000Z', { address: 'interview', unread: 5 }),
  row('zhouke', 'person', '2026-11-03T05:00:00.000Z'),
  row('hunters', 'group', '2026-11-03T06:00:00.000Z'),
  row('quiet', 'person', null),
  row('asking', 'person', '2026-11-04T03:00:00.000Z', { state: 'request' }),
  row('blocked', 'person', '2026-11-04T03:00:00.000Z', { state: 'blocked' }),
];

describe('Message list filters', () => {
  it('has 4 tabs (Contacts, Groups, Email, All) defaulting to Contacts', () => {
    expect(MESSAGE_FILTERS.map((filter) => FILTER_LABELS[filter])).toEqual(['联系人', '群组', '邮件', '全部']);
    expect(DEFAULT_MESSAGE_FILTER).toBe('people');
  });

  it('each tab filters strictly to its type; new requests row appears in All and Contacts', () => {
    expect(rowsFor(ROWS, 'people').map((entry) => entry.id)).toEqual(['zhouke', 'linyi', 'quiet']);
    expect(rowsFor(ROWS, 'groups').map((entry) => entry.id)).toEqual(['hunters']);
    expect(rowsFor(ROWS, 'mail').map((entry) => entry.id)).toEqual(['mail:bill@example.com', 'mail:news@example.com']);
    expect([showsRequests('all'), showsRequests('people'), showsRequests('groups'), showsRequests('mail')])
      .toEqual([true, true, false, false]);
  });

  it('All lists people/groups before email/system by recency, excluding requests and blocked', () => {
    expect(listedContacts(ROWS).map((entry) => entry.id)).toEqual(['hunters', 'zhouke', 'linyi', 'quiet',
      'mail:bill@example.com', 'system:interview', 'system:patrol', 'mail:news@example.com']);
    expect(rowsFor(ROWS, 'all')).toEqual(listedContacts(ROWS));
  });

  it('maps open item to its tab: person->Contacts, group->Groups, email->Email, system->All only', () => {
    const byId = (id: string): ContactRow => ROWS.find((entry) => entry.id === id)!;
    expect(filterForContact(byId('linyi'))).toBe('people');
    expect(filterForContact(byId('hunters'))).toBe('groups');
    expect(filterForContact(byId('mail:news@example.com'))).toBe('mail');
    expect(filterForContact(byId('system:patrol'))).toBe('all');
  });
});
