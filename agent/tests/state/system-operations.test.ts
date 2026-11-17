// 设置 · 系统「运行情况」的发信那一行：只看回信发成没有。通知邮件早就不发了，它留在库里的最后一次时间不能再显示
// 成「最近发信」。

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

test('通知邮件留下的旧时间和旧错误不算最近发信', () => {
  const raw = new DatabaseSync(t.path);
  raw.prepare(`INSERT INTO notification_mail_status (id, sent_at, checked_at, error)
    VALUES (1, '2026-11-04T11:06:14.980Z', '2026-11-04T11:06:14.981Z', '旧的发信错误')`).run();
  raw.close();
  assert.deepEqual(t.state.systemOperations.read().mail,
    { sentAt: null, sendError: null, receivedAt: null, receiveError: null });
});
