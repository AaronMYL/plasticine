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

test('邮件回复寄回原发件人（第 113 条）：标题加 Re:、带原信 Message-ID；同一个 requestId 不发第二封', async () => {
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

test('干跑只记不发：回复记成 dry_run，不调用发信', async () => {
  const message = add();
  const reply = await desk(true).reply(message.id, '收到', 'req-00000002', 'd1');
  assert.equal(reply.status, 'dry_run');
  assert.equal(sent.length, 0);
  assert.equal(t.state.receipts.get('inbox-reply:req-00000002')?.status, 'dry_run');
});

test('外部服务明说没发出去记 failed（同一个 requestId 可以再发）；说不清的记 unknown', async () => {
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

test('邮箱没连上：记成失败，不调用发信', async () => {
  const message = add();
  const inbox = new InboxDesk({ state: t.state, mail: { configured: () => false, send: async () => {
    throw new Error('不该发');
  } }, dryRun: false, now });
  const reply = await inbox.reply(message.id, '好的', 'req-00000012', 'd1');
  assert.equal(reply.status, 'failed');
  assert.match(reply.error ?? '', /邮箱还没连接/);
});

test('别的来源没有外发的去处：回复只记在站内信里', async () => {
  const feedback = add({ source: 'feedback', messageId: null, fromAddress: '小雨' });
  const reply = await desk().reply(feedback.id, '谢谢', 'req-00000003', 'd1');
  assert.equal(reply.status, 'stored');
  assert.equal(sent.length, 0);
});

test('原有邮件回复重放仍返回同一条历史，不同文字拒绝且不发信；新的 requestId 照常发', async () => {
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

test('说不清发没发出去：结果待核实，重发不再发；你说没发出去之后记成失败', async () => {
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

test('旧的失败回复重放照常可读，不自动重发', async () => {
  const message = add();
  const inbox = desk();
  const failed = t.state.inboxReplies.create({ messageId: message.id, text: '好的',
    actionId: 'inbox-reply:old-failure', deviceId: 'd1', status: 'failed', sentAt: null, error: '旧发信失败' });
  assert.equal((await inbox.reply(message.id, '好的', 'old-failure', 'd1')).id, failed.id);
  assert.equal(sent.length, 0);
});

test('已读 / 收藏 / 归档是时间；全部标已读只动这一类里没读的', () => {
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
