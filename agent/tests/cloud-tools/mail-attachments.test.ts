import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  attachmentText,
  CloudToolError,
  createGmailTransports,
  createMailSender,
  CredentialFiles,
  MailSync,
  type FetchedMail,
  type ImapCursor,
  type OutgoingMail,
} from '../../src/cloud-tools/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { dirname } from 'node:path';
import { assertNoPrivateText, captureLogs, PRIVATE_ERROR_TEXT } from '../safety-helpers.ts';

let t: TestState;
let credentials: CredentialFiles;

beforeEach(async () => {
  t = await openTestState();
  const directory = join(dirname(t.path), 'credentials');
  mkdirSync(directory, { recursive: true });
  credentials = new CredentialFiles(directory, false);
});

afterEach(async () => {
  await t.cleanup();
});

function setUp(name: string): void {
  writeFileSync(join(dirname(t.path), 'credentials', name), 'placeholder');
}

function mail(uid: number, overrides: Partial<FetchedMail> = {}): FetchedMail {
  return {
    uid,
    messageId: `<m${uid}@example.com>`,
    fromAddress: 'friend@example.com',
    fromName: '朋友',
    toAddress: 'me@example.com',
    subject: `第 ${uid} 封`,
    text: '正文',
    date: '2026-10-27T01:00:00.000Z',
    attachments: [],
    ...overrides,
  };
}

const signal = new AbortController().signal;

test('收信：没放凭据不收；收进站内信，同一个 Message-ID 不重复，记下收到哪了', async () => {
  const cursors: ImapCursor[] = [];
  const batches = [[mail(1), mail(2)], [mail(2), mail(3, { messageId: null, subject: '' })]];
  const sync = new MailSync({
    state: t.state,
    credentials,
    now: () => new Date('2026-10-27T02:00:00Z'),
    transport: {
      fetch: async (_account, cursor) => {
        cursors.push(cursor);
        return { uidValidity: 7, messages: batches.shift() ?? [] };
      },
    },
  });
  assert.equal(sync.scan(), 'skipped');
  setUp('gmail');
  assert.equal(await sync.sync(signal), 2);
  assert.equal(await sync.sync(signal), 1);
  assert.deepEqual(cursors, [{ uidValidity: null, lastUid: null }, { uidValidity: 7, lastUid: 2 }]);
  assert.equal(t.state.inboxMessages.count({ box: 'email' }), 3);
  const untitled = t.state.inboxMessages.byMessageId('uid-7-3');
  assert.equal(untitled?.title, '正文');
  assert.equal(t.state.inboxSync.get()?.lastUid, 3);
});

test('Gmail 凭据传输边界不把含服务器密码的认证异常写入同步状态', async (context) => {
  const lines = captureLogs(context);
  writeFileSync(join(dirname(t.path), 'credentials', 'gmail'), JSON.stringify({
    address: 'me@example.com', appPassword: 'fixture-mail-password',
  }));
  const transport = createGmailTransports({ credentials, connect: async () => {
    throw new Error('NO [AUTHENTICATIONFAILED] user=me@example.com pass=fixture-mail-password');
  } });
  const sync = new MailSync({
    state: t.state,
    credentials,
    now: () => new Date(),
    transport: transport.imap,
  });
  assert.equal(sync.scan(), 'started');
  await assert.rejects(sync.sync(signal));
  const error = t.state.inboxSync.get()?.lastError ?? '';
  assert.match(error, /收信失败/);
  assert.doesNotMatch(JSON.stringify([error, lines]), /fixture-mail-password|pass=/);
});

test('发信：没放凭据也照样经传输（传输自己读）；地址不对、标题带换行的不发', async () => {
  const sent: OutgoingMail[] = [];
  const sender = createMailSender({ send: async (_account, outgoing) => void sent.push(outgoing) }, credentials);
  assert.equal(sender.configured(), false);
  const base = { text: 't', inReplyTo: null };
  await assert.rejects(sender.send({ ...base, to: 'not-mail', subject: 's' }, signal), CloudToolError);
  await assert.rejects(sender.send({ ...base, to: 'a@b.cc', subject: 'x\r\nBcc: z@z.zz' }, signal), /换行/);
  await sender.send({ to: 'a@b.cc', subject: 'Re: 周末见', text: '好的', inReplyTo: '<m1@example.com>' }, signal);
  assert.equal(sent.length, 1);
});

test('收信业务失败保留具体原因和原因链，异常名不进入日志', async (context) => {
  const lines = captureLogs(context);
  setUp('gmail');
  const named = new Error('解析邮件 UID 17 失败', { cause: new Error('BODYSTRUCTURE 缺少文本部分') });
  named.name = PRIVATE_ERROR_TEXT;
  let instant = Date.now();
  for (const error of [new CloudToolError('failed', 'IMAP INBOX 的 UID 17 获取失败'), named]) {
    instant += 10 * 60_000;
    const sync = new MailSync({
      state: t.state,
      credentials,
      now: () => new Date(instant),
      transport: { fetch: () => Promise.reject(error) },
    });
    assert.equal(sync.scan(), 'started');
    await assert.rejects(sync.sync(signal));
    assertNoPrivateText(lines);
    const reason = t.state.inboxSync.get()?.lastError ?? '';
    assert.ok(reason.includes(error.message));
    if (error.cause instanceof Error) { assert.ok(reason.includes(error.cause.message)); }
  }
  assert.match(lines.join('\n'), /mail_sync_failed/);
});

test('附件转文字：文字类直接读；PDF 要开头对得上才转；不认识的、太大的、带 NUL 的拒', async () => {
  const transport = { toText: async () => 'PDF 里的字' };
  const text = await attachmentText(transport, { name: '笔记.md', data: Buffer.from('# 标题\n正文') }, signal);
  assert.equal(text.text, '# 标题\n正文');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10)]);
  assert.equal((await attachmentText(transport, { name: '合同.PDF', data: pdf }, signal)).text, 'PDF 里的字');
  await assert.rejects(attachmentText(transport, { name: '假的.pdf', data: Buffer.from('hello') }, signal), /对不上/);
  await assert.rejects(attachmentText(transport, { name: 'run.exe', data: Buffer.from('MZ') }, signal), /不认识/);
  await assert.rejects(attachmentText(transport, { name: 'a.txt', data: Buffer.from([0x61, 0, 0x62]) }, signal), /NUL/);
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0x61);
  await assert.rejects(attachmentText(transport, { name: 'a.txt', data: big }, signal), /超过/);
});
