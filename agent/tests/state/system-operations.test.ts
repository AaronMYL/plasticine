// 设置 · 系统「运行情况」的发信那一行：只看回信发成没有。通知邮件早就不发了，记它最后一次时间的那张表
// （notification_mail_status）11-17 由迁移 0147 删掉，不会再显示成「最近发信」。

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

test('没回过信、没收过信：发信和收信两行都是空的；通知邮件那张旧表已经不在', () => {
  assert.deepEqual(t.state.systemOperations.read().mail,
    { sentAt: null, sendError: null, receivedAt: null, receiveError: null });
  const raw = new DatabaseSync(t.path);
  try {
    const found = raw.prepare("SELECT name FROM sqlite_schema WHERE name IN ('notification_mail_status', " +
      "'mail_fallback_settings')").all();
    assert.deepEqual(found, []);
  } finally {
    raw.close();
  }
});

test('最近发信只看发出去的回信', () => {
  const message = t.state.inboxMessages.add({ source: 'email', fromAddress: 'lin@example.test', fromName: '小林',
    title: '周会改期', body: '改到周四', receivedAt: '2026-11-16T02:00:00.000Z',
    messageId: '<weekly@example.test>' }).message;
  const raw = new DatabaseSync(t.path);
  try {
    raw.prepare(`INSERT INTO inbox_replies (id, created_at, updated_at, version, message_id, text, status,
      action_id, sent_at) VALUES ('r1', '2026-11-16T03:00:00.000Z', '2026-11-16T03:00:05.000Z', 1, ?, '好的', 'sent',
      'act-r1', '2026-11-16T03:00:05.000Z')`).run(message.id);
  } finally {
    raw.close();
  }
  assert.deepEqual(t.state.systemOperations.read().mail,
    { sentAt: '2026-11-16T03:00:05.000Z', sendError: null, receivedAt: '2026-11-16T02:00:00.000Z',
      receiveError: null });
});
