// 消息第二栏的筛选（11-07 设计稿 Messages）：全部 · 人 · 群 · 邮件；Plasticine 不在消息里，「AI 建议」那一段去掉。
// 每一段里人和群在前、邮件和系统来源在后，各自按最近一句排；请求和拉黑的不在列表里（请求在「新请求」那一行）。
// 打开的那一条不在当前筛选里时换到它所在的那一段；系统来源只在全部里。

import { describe, expect, it } from 'vitest';
import type { ContactRow } from '../../../src/api/shared.ts';
import {
  FILTER_LABELS,
  MESSAGE_FILTERS,
  filterForContact,
  listedContacts,
  rowsFor,
  showsRequests,
} from '../../../src/views/messages/message-filter.ts';

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

describe('消息列表的筛选', () => {
  it('四段：全部 · 人 · 群 · 邮件，默认全部', () => {
    expect(MESSAGE_FILTERS.map((filter) => FILTER_LABELS[filter])).toEqual(['全部', '联系人', '群组', '邮件']);
  });

  it('人只有人，群只有群，邮件只有邮件；新请求那一行在全部和人里', () => {
    expect(rowsFor(ROWS, 'people').map((entry) => entry.id)).toEqual(['zhouke', 'linyi', 'quiet']);
    expect(rowsFor(ROWS, 'groups').map((entry) => entry.id)).toEqual(['hunters']);
    expect(rowsFor(ROWS, 'mail').map((entry) => entry.id)).toEqual(['mail:bill@example.com', 'mail:news@example.com']);
    expect([showsRequests('all'), showsRequests('people'), showsRequests('groups'), showsRequests('mail')])
      .toEqual([true, true, false, false]);
  });

  it('全部：人和群在前，邮件和系统来源在后，各自按最近一句排；请求和拉黑的不在列表里', () => {
    expect(listedContacts(ROWS).map((entry) => entry.id)).toEqual(['hunters', 'zhouke', 'linyi', 'quiet',
      'mail:bill@example.com', 'system:interview', 'system:patrol', 'mail:news@example.com']);
    expect(rowsFor(ROWS, 'all')).toEqual(listedContacts(ROWS));
  });

  it('打开的那一条在哪一段：人在人，群在群，邮件在邮件，系统来源只在全部', () => {
    const byId = (id: string): ContactRow => ROWS.find((entry) => entry.id === id)!;
    expect(filterForContact(byId('linyi'))).toBe('people');
    expect(filterForContact(byId('hunters'))).toBe('groups');
    expect(filterForContact(byId('mail:news@example.com'))).toBe('mail');
    expect(filterForContact(byId('system:patrol'))).toBe('all');
  });
});
