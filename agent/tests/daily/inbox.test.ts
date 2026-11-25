import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { InboxMessageInput } from '../../shared/state.ts';
import { CloudToolError, type MailSender } from '../../src/cloud-tools/index.ts';
import { DailyError, InboxDesk } from '../../src/daily/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let sent: { to: string; subject: string; text: string; inReplyTo: string | null }[];
let failNext: Error | null;

const now = (): Date => new Date('2026-10-27T01:00:00Z');

function sender(): MailSender {
  return {
    configured: () => true,
    send: async (input) => {
      if (failNext !== null) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      sent.push(input);
    },
  };
}

function desk(dryRun = false): InboxDesk {
  return new InboxDesk({ state: t.state, mail: sender(), dryRun, now });
}

function add(overrides: Partial<InboxMessageInput> = {}) {
  return t.state.inboxMessages.add({
    source: 'email',
    fromAddress: 'friend@example.com',
    title: '周末见',
    body: '周六下午三点。',
    receivedAt: now().toISOString(),
    messageId: '<m1@example.com>',
    ...overrides,
  }).message;
}

beforeEach(async () => {
  t = await openTestState();
  sent = [];
  failNext = null;
});

afterEach(async () => {
  await t.cleanup();
});

test('email reply sends to original sender with Re: and Message-ID; same requestId sends once', async () => {
  const message = add();
  const inbox = desk();
  const reply = await inbox.reply(message.id, '好的', 'req-00000001', 'd1');
  assert.equal(reply.status, 'sent');
  assert.notEqual(reply.sentAt, null);
  assert.deepEqual(sent, [{ to: 'friend@example.com', subject: 'Re: 周末见', text: '好的',
    inReplyTo: '<m1@example.com>' }]);
  assert.equal((await inbox.reply(message.id, '好的', 'req-00000001', 'd1')).id, reply.id);
  assert.equal(sent.length, 1);
  assert.equal(t.state.receipts.get('inbox-reply:req-00000001')?.status, 'succeeded');
});

test('dry-run reply records dry_run status without invoking mail transport', async () => {
  const message = add();
  const reply = await desk(true).reply(message.id, '收到', 'req-00000002', 'd1');
  assert.equal(reply.status, 'dry_run');
  assert.equal(sent.length, 0);
  assert.equal(t.state.receipts.get('inbox-reply:req-00000002')?.status, 'dry_run');
});

test('explicit external failure marks failed (retryable); ambiguous failure marks unknown', async () => {
  const message = add();
  const inbox = desk();
  failNext = new CloudToolError('failed', '邮件没有发出，请检查 Gmail 配置后再试。');
  const failed = await inbox.reply(message.id, '好的', 'req-00000010', 'd1');
  assert.equal(failed.status, 'failed');
  assert.equal(sent.length, 0);
  failNext = new CloudToolError('unknown', '邮件发送结果待核实，请先检查自己的收件箱。');
  const unknown = await inbox.reply(message.id, '再说一句', 'req-00000011', 'd1');
  assert.equal(unknown.status, 'unknown');
});

test('disconnected mailbox marks email reply failed without invoking transport', async () => {
  const message = add();
  const inbox = new InboxDesk({ state: t.state, mail: { configured: () => false, send: async () => {
    throw new Error('不该发');
  } }, dryRun: false, now });
  const reply = await inbox.reply(message.id, '好的', 'req-00000012', 'd1');
  assert.equal(reply.status, 'failed');
  assert.match(reply.error ?? '', /邮箱还没连接/);
});

test('non-email sources without outbound route record reply internally in inbox only', async () => {
  const feedback = add({ source: 'feedback', messageId: null, fromAddress: '小雨' });
  const reply = await desk().reply(feedback.id, '谢谢', 'req-00000003', 'd1');
  assert.equal(reply.status, 'stored');
  assert.equal(sent.length, 0);
});

test('replaying email reply returns original history, rejects altered text; new requestId sends', async () => {
  const message = add();
  const inbox = desk();
  const old = t.state.inboxReplies.create({ messageId: message.id, text: '好的',
    actionId: 'inbox-reply:req-old', deviceId: 'd1', status: 'sent', sentAt: now().toISOString(), error: null });
  assert.equal((await inbox.reply(message.id, '好的', 'req-old', 'd1')).id, old.id);
  await assert.rejects(inbox.reply(message.id, '换了字', 'req-old', 'd1'), DailyError);
  assert.equal(sent.length, 0);
  assert.equal((await inbox.reply(message.id, '好的', 'req-new', 'd1')).status, 'sent');
  assert.equal(sent.length, 1);
});

test('ambiguous send marks pending-verify and blocks replay; settling as unsent marks failed', async () => {
  const message = add();
  const inbox = desk();
  const unknown = t.state.inboxReplies.create({ messageId: message.id, text: '好的',
    actionId: 'inbox-reply:req-00000006', deviceId: 'd1', status: 'unknown', sentAt: null, error: null });
  assert.equal(unknown.status, 'unknown');
  assert.equal((await inbox.reply(message.id, '好的', 'req-00000006', 'd1')).status, 'unknown');
  assert.equal(sent.length, 0);
  const settled = inbox.settleReply(unknown.id, false);
  assert.equal(settled.status, 'failed');
  assert.equal(inbox.settleReply(unknown.id, true).status, 'failed');
});

test('replaying legacy failed reply remains readable without auto-resending', async () => {
  const message = add();
  const inbox = desk();
  const failed = t.state.inboxReplies.create({ messageId: message.id, text: '好的',
    actionId: 'inbox-reply:old-failure', deviceId: 'd1', status: 'failed', sentAt: null, error: '旧发信失败' });
  assert.equal((await inbox.reply(message.id, '好的', 'old-failure', 'd1')).id, failed.id);
  assert.equal(sent.length, 0);
});

test('read/star/archive store timestamps; mark-all-read updates only unread items in that category', () => {
  const inbox = desk();
  const mail = add();
  add({ source: 'feedback', messageId: null, title: '反馈' });
  const read = inbox.setFlags(mail.id, mail.version, { read: true, starred: true });
  assert.notEqual(read.readAt, null);
  assert.notEqual(read.starredAt, null);
  assert.equal(inbox.unread().total, 1);
  const changed = inbox.readAll('feedback', (action) => action());
  assert.equal(changed.length, 1);
  assert.equal(inbox.unread().total, 0);
  const unread = inbox.setFlags(read.id, read.version, { read: false });
  assert.equal(unread.readAt, null);
  assert.notEqual(unread.starredAt, null);
});
