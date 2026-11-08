// 迁移 0048：已经收进来的 Plasticine 自己的通知信（自己寄给自己、标题「Plasticine ·」「Plasticine：」开头）改成
// plasticine 来源，标题去掉前缀，记成的触发改成 Plasticine 自己说的；别人寄来的、标题只是像的，一样不动；重跑不再改。
// 迁移 0049：改过来以后和迁来的原通知重了的那封收起来。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import { steppingClock } from './helpers.ts';
import { insertOldInbox, readInbox, type OldInboxRow } from './old-inbox.ts';

const AT = '2026-11-01T00:30:00.000Z';

test('0047 的库：自己寄给自己的 Plasticine 通知改成 plasticine 来源，触发改成自己说的；别的信不动，重跑不变', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0048'), now);
    const base = { source: 'email', fromAddress: 'me@example.com', fromName: 'Plasticine', body: '正文',
      receivedAt: AT, toAddress: 'Me <me@example.com>' };
    const add = (row: Omit<OldInboxRow, keyof typeof base> & Partial<OldInboxRow>) => {
      const full = { ...base, ...row };
      insertOldInbox(db, full);
      return { id: full.id, title: full.title, fromAddress: full.fromAddress, version: 1 };
    };
    const daily = add({ id: 'id-1', title: 'Plasticine · 今天的备份没到', messageId: '<a>' });
    const fallback = add({ id: 'id-2', fromName: null, title: 'Plasticine：订阅需要重新登录', messageId: '<b>' });
    const empty = add({ id: 'id-3', title: 'Plasticine · ', messageId: '<c>' });
    const stranger = add({ id: 'id-4', fromAddress: 'x@example.com', fromName: 'X', title: 'Plasticine · 请点链接',
      messageId: '<d>' });
    const weekly = add({ id: 'id-5', title: 'Plasticine 周报', messageId: '<e>' });
    db.exec(`INSERT INTO intake_sources (id, created_at, updated_at, version, kind, label, config)
      VALUES ('src-mail', '${AT}', '${AT}', 1, 'mail', '邮件', '{}')`);
    for (const message of [daily, stranger]) {
      db.exec(`INSERT INTO triggers (id, source_id, kind, external_key, thread_keys, actor, actor_source_kind,
        occurred_at, received_at, ref_type, ref_id, summary, facts)
        VALUES ('t-${message.id}', 'src-mail', 'mail.received', '${message.id}', '[]', 'person:${message.fromAddress}',
        'independent_statement', '${AT}', '${AT}', 'inbox_message', '${message.id}', '${message.title}', '{}')`);
    }

    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id < '0049'), now), ['0048-own-notices']);
    const view = (id: string) => {
      const row = readInbox(db, id);
      return [row['source'], row['from_address'], row['from_name'], row['title']];
    };
    assert.deepEqual(view(daily.id), ['plasticine', 'plasticine', null, '今天的备份没到']);
    assert.deepEqual(view(fallback.id), ['plasticine', 'plasticine', null, '订阅需要重新登录']);
    assert.deepEqual(view(empty.id), ['plasticine', 'plasticine', null, '（没有标题）']);
    assert.deepEqual(view(stranger.id), ['email', 'x@example.com', 'X', 'Plasticine · 请点链接']);
    assert.deepEqual(view(weekly.id), ['email', 'me@example.com', 'Plasticine', 'Plasticine 周报']);
    assert.equal(readInbox(db, daily.id)['version'], daily.version + 1);
    const actors = db.all('SELECT ref_id, actor, actor_source_kind FROM triggers ORDER BY ref_id')
      .map((row) => [row['ref_id'], row['actor'], row['actor_source_kind']]);
    assert.deepEqual(actors, [
      [daily.id, 'plasticine', 'own_reasoning'],
      [stranger.id, 'person:x@example.com', 'independent_statement'],
    ]);
    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id < '0049'), now), []);
  } finally {
    db.close();
  }
});

test('0049：迁来的通知和它发到 Gmail 又收回来的那封成了两份，收回来的那封收起（不删）；没原件的、隔得远的不动', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, MIGRATIONS.filter((entry) => entry.id < '0049'), now);
    const notice = { source: 'plasticine', fromAddress: 'plasticine', body: '正文', title: '今天的备份没到' };
    const add = (id: string, receivedAt: string, messageId: string | null, title = notice.title) => {
      insertOldInbox(db, { ...notice, id, title, receivedAt, messageId });
      return { id, version: 1 };
    };
    const original = add('id-1', '2026-10-27T00:30:21.293Z', null);
    const echo = add('id-2', '2026-10-27T00:30:20.000Z', '<echo@mail>');
    const later = add('id-3', '2026-10-27T01:30:20.000Z', '<later@mail>');
    const alone = add('id-4', '2026-11-04T00:00:15.000Z', '<alone@mail>', '今日碰撞');

    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id < '0050'), now), ['0049-own-notice-twins']);
    const archived = (id: string) => readInbox(db, id)['archived_at'] !== null;
    assert.deepEqual([original, echo, later, alone].map((row) => archived(row.id)), [false, true, false, false]);
    assert.equal(readInbox(db, echo.id)['version'], echo.version + 1);
    assert.match(String(readInbox(db, echo.id)['archived_at']), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id < '0050'), now), []);
  } finally {
    db.close();
  }
});
