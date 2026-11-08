// mail.refetch 的抓取一侧：假 Gmail（本机回环）里只读地在「所有邮件」找回整封，原地补进站内信那一行；找不到的留着原文字、
// 记下找过；补过的重跑跳过。

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createGmailTransports } from '../../src/cloud-tools/gmail.ts';
import { allMailbox } from '../../src/cloud-tools/gmail-refetch.ts';
import { MailFiles } from '../../src/cloud-tools/mail-files.ts';
import { MailRefetch } from '../../src/cloud-tools/mail-refetch.ts';
import type { InboxMessageInput } from '../../shared/state.ts';
import { openTestState, type TestState } from '../state/helpers.ts';
import { fakeImap, fixture, type FakeMessage } from './fake-imap.ts';

let t: TestState;
let f: ReturnType<typeof fixture>;

beforeEach(async () => {
  t = await openTestState();
  f = fixture();
  f.put();
});

afterEach(async () => {
  await t.cleanup();
  f.close();
});

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function rich(id: string, subject: string, date: string): string {
  return [`Message-ID: ${id}`, 'From: Reddit <noreply@redditmail.com>', `Subject: ${subject}`, `Date: ${date}`,
    'Content-Type: multipart/related; boundary="r"', '',
    '--r', 'Content-Type: text/html; charset=utf-8', '',
    '<p>Hi &#20320;</p><p><img src="cid:logo@x"><script>alert(1)</script></p>',
    '--r', 'Content-Type: image/png', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '',
    PNG.toString('base64'), '--r--', ''].join('\r\n');
}

function row(n: number, overrides: Partial<InboxMessageInput> = {}): InboxMessageInput {
  return { source: 'email', fromAddress: 'noreply@redditmail.com', fromName: 'Reddit', title: `热帖 ${n}`,
    body: `Hi &#20320; 第 ${n} 封压成一行`, receivedAt: `2026-10-2${n}T08:00:00.000Z`,
    messageId: `<m${n}@redditmail.com>`, ...overrides };
}

test('LIST 里认带 \\All 的「所有邮件」，名字随界面语言变；没有就用英文默认名', () => {
  assert.equal(allMailbox(['* LIST (\\HasNoChildren) "/" "INBOX"',
    '* LIST (\\All \\HasNoChildren) "/" "[Gmail]/&YkBnCZCuTvY-"']), '[Gmail]/&YkBnCZCuTvY-');
  assert.equal(allMailbox(['* LIST (\\HasNoChildren) "/" "INBOX"']), '[Gmail]/All Mail');
});

test('按 Message-ID 找到的原地补：同一行、版本加 1、HTML 清洗过、原信和内嵌图落盘；找不到的留原文字；重跑跳过补过的',
  async () => {
    const found = t.state.inboxMessages.add(row(1)).message;
    const missing = t.state.inboxMessages.add(row(2)).message;
    const legacy = t.state.inboxMessages.add(row(3, { messageId: 'legacy-xyz', title: '旧版迁来的' }),
      { migratedDefault: true, legacyPayload: { table: 'inbox/messages.json' } }).message;
    const messages: FakeMessage[] = [
      { uid: 41, raw: rich('<m1@redditmail.com>', '热帖 1', 'Wed, 21 Oct 2026 08:00:00 +0000') },
      { uid: 42, raw: rich('<other@redditmail.com>', '旧版迁来的', 'Fri, 23 Oct 2026 08:00:02 +0000') },
      { uid: 43, raw: rich('<noise@redditmail.com>', '别的标题', 'Fri, 23 Oct 2026 08:00:00 +0000') },
    ];
    const fake = await fakeImap({ validity: 77, messages, allMail: '[Gmail]/&YkBnCZCuTvY-' });
    const directory = dirname(t.path);
    const transport = createGmailTransports({ credentials: f.credentials, connect: fake.dial }).imap;
    const refetch = new MailRefetch({ state: t.state, transport, credentials: f.credentials,
      files: new MailFiles(directory), now: () => new Date('2026-11-04T10:00:00.000Z'), sleep: async () => {} });
    try {
      const report = await refetch.run(10, AbortSignal.timeout(5_000));
      assert.deepEqual([report.tried, report.found, report.notFound, report.errors, report.remaining], [3, 2, 1, 0, 0]);
      const byId = Object.fromEntries(report.items.map((item) => [item.id, item.outcome]));
      assert.deepEqual(byId, { [found.id]: 'found', [missing.id]: 'not_found', [legacy.id]: 'found' });

      const filled = t.state.inboxMessages.require(found.id);
      assert.equal(filled.version, found.version + 1);
      assert.equal(filled.body, 'Hi 你');
      assert.match(filled.bodyHtml ?? '', /<p>Hi &#20320;<\/p><p><img src="cid:logo@x"><\/p>/);
      assert.deepEqual([filled.imapUid, filled.uidValidity, filled.mailbox], [41, 77, '[Gmail]/&YkBnCZCuTvY-']);
      assert.equal(filled.receivedAt, found.receivedAt);
      assert.equal(filled.rawPath, `mail/raw/${found.id}.eml`);
      const raw = join(directory, filled.rawPath ?? '');
      assert.equal(readFileSync(raw, 'utf8'), messages[0]?.raw);
      if (process.platform !== 'win32') {
        assert.equal(statSync(raw).mode & 0o777, 0o600);
      }
      const parts = t.state.inboxMailParts.forMessage(found.id);
      assert.deepEqual(parts.map((part) => [part.contentId, part.type, part.size]), [['logo@x', 'image/png', 8]]);
      assert.deepEqual(readFileSync(join(directory, parts[0]?.path ?? '')), PNG);

      const kept = t.state.inboxMessages.require(missing.id);
      assert.equal(kept.body, missing.body);
      assert.equal(kept.bodyHtml, null);
      assert.equal(kept.mimeTriedAt, '2026-11-04T10:00:00.000Z');
      assert.equal(t.state.inboxMessages.require(legacy.id).imapUid, 42);

      assert.ok(fake.commands.some((line) => line.endsWith('EXAMINE "[Gmail]/&YkBnCZCuTvY-"')));
      assert.ok(fake.commands.some((line) => line.endsWith('UID SEARCH HEADER Message-ID "<m1@redditmail.com>"')));
      assert.ok(fake.commands.some((line) =>
        line.includes('UID SEARCH FROM "noreply@redditmail.com" SINCE 22-Oct-2026')));
      assert.ok(fake.commands.every((line) => !/SELECT|STORE|DELETE|EXPUNGE|COPY|MOVE|BODY\[/.test(line)));

      const again = await refetch.run(10, AbortSignal.timeout(5_000));
      assert.deepEqual(again.items.map((item) => [item.id, item.outcome]), [[missing.id, 'not_found']]);
      assert.equal(t.state.inboxMessages.require(found.id).version, filled.version);
    } finally {
      await fake.close();
    }
  });

test('Gmail 还没接上就整条拒绝，不动任何一行', async () => {
  const message = t.state.inboxMessages.add(row(1)).message;
  const refetch = new MailRefetch({ state: t.state, transport: { fetch: async () => ({ uidValidity: 1,
    messages: [] }) }, credentials: f.credentials, files: new MailFiles(dirname(t.path)), now: () => new Date() });
  await assert.rejects(refetch.run(10, AbortSignal.timeout(1_000)), /还没接上 Gmail/);
  assert.equal(t.state.inboxMessages.require(message.id).version, message.version);
  assert.ok(!existsSync(join(dirname(t.path), 'mail')));
});

test('连接出错的那一块记成出错、不记找过，下次重跑还会再找', async () => {
  const message = t.state.inboxMessages.add(row(1)).message;
  const refetch = new MailRefetch({ state: t.state, credentials: f.credentials, files: new MailFiles(dirname(t.path)),
    now: () => new Date(), transport: { fetch: async () => ({ uidValidity: 1, messages: [] }),
      refetch: async () => {
        throw new Error('连接断了');
      } } });
  const report = await refetch.run(10, AbortSignal.timeout(1_000));
  assert.deepEqual([report.errors, report.remaining], [1, 1]);
  assert.equal(t.state.inboxMessages.require(message.id).mimeTriedAt, null);
});
