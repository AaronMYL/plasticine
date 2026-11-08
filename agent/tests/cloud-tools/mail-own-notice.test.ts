import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { CredentialFiles, MailSync, ownNoticeTitle, type FetchedMail } from '../../src/cloud-tools/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let credentials: CredentialFiles;

beforeEach(async () => {
  t = await openTestState();
  const directory = join(dirname(t.path), 'credentials');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'gmail'), 'placeholder');
  credentials = new CredentialFiles(directory, false);
});

afterEach(async () => {
  await t.cleanup();
});

function mail(uid: number, overrides: Partial<FetchedMail> = {}): FetchedMail {
  return {
    uid,
    messageId: `<n${uid}@example.com>`,
    fromAddress: 'me@example.com',
    fromName: 'Plasticine',
    toAddress: 'Me <me@example.com>',
    subject: 'Plasticine · 今天的备份没到',
    text: '正文',
    date: '2026-11-04T00:30:00.000Z',
    attachments: [],
    ...overrides,
  };
}

test('自己寄给自己、标题以「Plasticine ·」「Plasticine：」开头的才算 Plasticine 的通知', () => {
  assert.equal(ownNoticeTitle({ fromAddress: 'me@example.com', toAddress: 'Me <ME@example.com>',
    subject: 'Plasticine · 今天的备份没到' }), '今天的备份没到');
  assert.equal(ownNoticeTitle({ fromAddress: 'me@example.com', toAddress: 'me@example.com',
    subject: 'Plasticine：订阅需要重新登录' }), '订阅需要重新登录');
  assert.equal(ownNoticeTitle({ fromAddress: 'me@example.com', toAddress: 'me@example.com',
    subject: 'Plasticine: ' }), '');
  // 别人寄来的、标题像通知的，照样是那个人的信。
  assert.equal(ownNoticeTitle({ fromAddress: 'other@example.com', toAddress: 'me@example.com',
    subject: 'Plasticine · 请点这个链接' }), null);
  assert.equal(ownNoticeTitle({ fromAddress: 'me@example.com', toAddress: null, subject: 'Plasticine · 备份' }), null);
  assert.equal(ownNoticeTitle({ fromAddress: 'me@example.com', toAddress: 'me@example.com',
    subject: 'Plasticine 周报' }), null);
});

test('收信：Plasticine 自己的通知记成 plasticine 来源（进通知记录，不成邮件联系人），别的信照旧', async () => {
  const batches = [[mail(1), mail(2, { subject: 'Plasticine · ' }), mail(3, { fromAddress: 'friend@example.com',
    fromName: '朋友', subject: 'Plasticine · 问一下' })]];
  const sync = new MailSync({
    state: t.state,
    credentials,
    now: () => new Date('2026-11-04T01:00:00Z'),
    transport: { fetch: async () => ({ uidValidity: 9, messages: batches.shift() ?? [] }) },
  });
  assert.equal(await sync.sync(new AbortController().signal), 3);
  const notice = t.state.inboxMessages.byMessageId('<n1@example.com>');
  assert.equal(notice?.source, 'plasticine');
  assert.equal(notice?.fromAddress, 'plasticine');
  assert.equal(notice?.fromName, null);
  assert.equal(notice?.title, '今天的备份没到');
  assert.equal(t.state.inboxMessages.byMessageId('<n2@example.com>')?.title, '（没有标题）');
  const friend = t.state.inboxMessages.byMessageId('<n3@example.com>');
  assert.equal(friend?.source, 'email');
  assert.equal(friend?.title, 'Plasticine · 问一下');
});
