// 迁移 0052 之后站内信存邮件的新列：收信时一起存 HTML、原信、位置；mail.refetch 原地补（版本加 1，不新建行）；
// 收起的重复哪里都不显示；内嵌分段同一个 Content-ID 只记一次。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { InboxMessageInput } from '../../shared/state.ts';
import { openTestState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function mail(n: number, overrides: Partial<InboxMessageInput> = {}): InboxMessageInput {
  return {
    source: 'email',
    fromAddress: 'friend@example.test',
    fromName: '朋友',
    title: `第 ${n} 封`,
    body: '正文',
    receivedAt: `2026-11-0${n}T08:00:00.000Z`,
    messageId: `<m${n}@example.test>`,
    ...overrides,
  };
}

const SHA = 'a'.repeat(64);

test('收信时 HTML、原信路径和散列、Gmail 位置一起存；没给的都是 null', () => {
  const { message } = t.state.inboxMessages.add(mail(1, { bodyHtml: '<p>正文</p>', rawPath: 'mail/raw/x.eml',
    rawSha256: SHA, imapUid: 7, uidValidity: 9, mailbox: 'INBOX', mimeAt: '2026-11-01T08:00:01.000Z' }));
  const stored = t.state.inboxMessages.require(message.id);
  assert.equal(stored.bodyHtml, '<p>正文</p>');
  assert.deepEqual([stored.rawPath, stored.rawSha256, stored.imapUid, stored.uidValidity, stored.mailbox],
    ['mail/raw/x.eml', SHA, 7, 9, 'INBOX']);
  const plain = t.state.inboxMessages.add(mail(2)).message;
  assert.deepEqual([plain.bodyHtml, plain.rawPath, plain.mimeAt, plain.duplicateOf], [null, null, null, null]);
});

test('原地补正文：还是那一行、版本加 1，发件地址、收到时间和已读不动；补过的不再列进待补', () => {
  const old = t.state.inboxMessages.add(mail(1, { body: 'Hi &#20320; 一行压扁' })).message;
  const read = t.state.inboxMessages.update(old.id, old.version, { readAt: '2026-11-01T09:00:00.000Z' });
  t.state.inboxMessages.add(mail(2, { source: 'patrol', fromAddress: '巡查' }));
  assert.deepEqual(t.state.inboxMessages.needingMime(10).map((row) => row.id), [old.id]);
  const refilled = t.state.inboxMessages.refill(old.id, read.version, {
    title: '你好', fromName: '朋友', toAddress: '我 <me@example.test>', body: 'Hi 你\n\n第二段',
    attachments: ['invite.ics'], bodyHtml: '<p>Hi 你</p><p>第二段</p>', rawPath: `mail/raw/${old.id}.eml`,
    rawSha256: SHA, imapUid: 3, uidValidity: 9, mailbox: '[Gmail]/All Mail', mimeAt: '2026-11-04T00:00:00.000Z',
  });
  assert.equal(refilled.id, old.id);
  assert.equal(refilled.version, read.version + 1);
  assert.equal(refilled.fromAddress, 'friend@example.test');
  assert.equal(refilled.receivedAt, old.receivedAt);
  assert.equal(refilled.readAt, '2026-11-01T09:00:00.000Z');
  assert.deepEqual(refilled.attachments, ['invite.ics']);
  assert.equal(t.state.inboxMessages.count({ box: 'email' }), 1);
  assert.deepEqual(t.state.inboxMessages.needingMime(10), []);
});

test('收起的重复：列表、未读、联系人、来往里都不出现，行还在', () => {
  const kept = t.state.inboxMessages.add(mail(1)).message;
  const twin = t.state.inboxMessages.add(mail(2, { messageId: 'legacy-2' })).message;
  t.state.inboxMessages.update(twin.id, twin.version, { duplicateOf: kept.id });
  assert.equal(t.state.inboxMessages.count({ box: 'all' }), 1);
  assert.equal(t.state.inboxMessages.count({ box: 'unread' }), 1);
  assert.equal(t.state.inboxMessages.unreadBySource().email, 1);
  assert.deepEqual(t.state.inboxMessages.emailSenders().map((row) => row.unread), [1]);
  assert.deepEqual(t.state.inboxMessages.thread({ address: 'friend@example.test' }, undefined, 10)
    .map((row) => row.id), [kept.id]);
  assert.deepEqual(t.state.inboxMessages.needingMime(10).map((row) => row.id), [kept.id]);
  assert.equal(t.state.inboxMessages.require(twin.id).duplicateOf, kept.id);
});

test('内嵌分段：同一封信同一个 Content-ID 只记一次，按信读回', () => {
  const { message } = t.state.inboxMessages.add(mail(1));
  const part = { messageId: message.id, contentId: 'logo@x', filename: 'logo.png', type: 'image/png', size: 8,
    path: `mail/parts/${message.id}/0` };
  assert.equal(t.state.inboxMailParts.add(part), true);
  assert.equal(t.state.inboxMailParts.add({ ...part, path: `mail/parts/${message.id}/1` }), false);
  const parts = t.state.inboxMailParts.forMessage(message.id);
  assert.deepEqual(parts.map((row) => [row.contentId, row.path, row.size]), [['logo@x', `mail/parts/${message.id}/0`,
    8]]);
});
