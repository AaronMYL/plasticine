// 迁移 0052：邮件按原样显示要的列（清洗后的 HTML、原信落盘的路径和散列、IMAP 位置、整封解析的时间、重复的那一封指向
// 留下的那一封）和内嵌分段表；旧版迁来的信和新同步又抓回的同一封，旧的那份收起来（duplicate_of），不删行。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_DATABASE, openDatabase } from '../../src/state/db.ts';
import { createInboxStores } from '../../src/state/inbox.ts';
import { migrate, MIGRATIONS } from '../../src/state/migrations/index.ts';
import type { StoreContext } from '../../src/state/object-store.ts';
import { steppingClock } from './helpers.ts';
import { insertOldInbox } from './old-inbox.ts';

const BEFORE = MIGRATIONS.filter((entry) => entry.id < '0052');

function legacy(row: { from: string; title: string; at: string }) {
  return { table: 'inbox/messages.json', row: { id: `old-${row.at}`, source: 'email', ...row } };
}

test('0051 的库：加列加表，旧版迁来的和新同步的同一封（同发件地址、同标题、十分钟内）旧的收起，别的不动，重跑不变', () => {
  const db = openDatabase(MEMORY_DATABASE);
  try {
    const now = steppingClock();
    migrate(db, BEFORE, now);
    let n = 0;
    const add = (row: { title: string; at: string; from?: string; legacy: boolean }) => {
      const from = row.from ?? 'noreply@redditmail.com';
      const id = `id-${(n += 1)}`;
      insertOldInbox(db, { id, source: 'email', fromAddress: from, fromName: 'Reddit', title: row.title,
        receivedAt: row.at, messageId: row.legacy ? `legacy-${id}` : `<${id}@redditmail.com>`,
        ...(row.legacy ? { legacy: legacy({ from, title: row.title, at: row.at }) } : {}) });
      return { id, title: row.title, version: 1 };
    };
    const imported = (title: string, at: string, from?: string) => add({ title, at, legacy: true,
      ...(from === undefined ? {} : { from }) });
    const synced = (title: string, at: string, from?: string) => add({ title, at, legacy: false,
      ...(from === undefined ? {} : { from }) });

    const oldCopy = imported('今日热帖', '2026-10-30T08:00:00.000Z');
    const newCopy = synced('今日热帖', '2026-10-30T08:00:03.000Z', 'NoReply@RedditMail.com ');
    const farOld = imported('今日热帖', '2026-10-31T08:00:00.000Z');
    const farNew = synced('今日热帖', '2026-10-31T09:00:00.000Z');
    const otherTitle = imported('另一封', '2026-10-30T08:00:00.000Z');
    const otherSender = imported('今日热帖', '2026-10-30T08:00:01.000Z', 'x@example.test');
    const onlyOld = imported('只有旧的', '2026-10-20T08:00:00.000Z');

    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id < '0053'), now), ['0052-mail-bodies']);
    const context: StoreContext = { db, now, newId: () => `new-${(n += 1)}` };
    const { inboxMessages } = createInboxStores(context);
    const duplicateOf = (id: string) => db.get('SELECT duplicate_of FROM inbox_messages WHERE id = $id', { id })
      ?.['duplicate_of'] ?? null;
    assert.equal(duplicateOf(oldCopy.id), newCopy.id);
    for (const row of [newCopy, farOld, farNew, otherTitle, otherSender, onlyOld]) {
      assert.equal(duplicateOf(row.id), null, row.title);
    }
    assert.equal(inboxMessages.require(oldCopy.id).version, oldCopy.version + 1);
    assert.equal(inboxMessages.require(oldCopy.id).body, '正文');

    const columns = db.all("SELECT name FROM pragma_table_info('inbox_messages')").map((row) => row['name']);
    for (const column of ['body_html', 'raw_path', 'raw_sha256', 'imap_uid', 'uid_validity', 'mailbox', 'mime_at',
      'mime_tried_at', 'duplicate_of']) {
      assert.ok(columns.includes(column), column);
    }
    const parts = db.all("SELECT name FROM pragma_table_info('inbox_mail_parts')").map((row) => row['name']);
    assert.deepEqual(parts, ['id', 'message_id', 'content_id', 'filename', 'type', 'size', 'path', 'created_at']);
    assert.equal(inboxMessages.require(newCopy.id).bodyHtml, null);
    assert.deepEqual(migrate(db, MIGRATIONS.filter((entry) => entry.id < '0053'), now), []);
  } finally {
    db.close();
  }
});
