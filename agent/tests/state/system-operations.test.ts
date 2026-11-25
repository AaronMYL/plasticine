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

test('Without sent/received mail both rows are empty and legacy notify table is gone', () => {
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

test('Recent sent mail considers only outgoing replies', () => {
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
