import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGmailTransports } from '../../src/cloud-tools/gmail.ts';
import { mailParts } from '../../src/cloud-tools/mail-bodystructure.ts';
import { MailSync, SELF_MAIL_ADDRESS } from '../../src/cloud-tools/mail.ts';
import { openTestState } from '../state/helpers.ts';
import { fakeImap, fakeServer, fixture, type FakeMessage } from './fake-imap.ts';

// 手录的协议样本，地址和密码都是占位；没有真实邮箱回包。
const HEAD = 'Message-ID: <sample@example.test>\r\nFrom: =?UTF-8?B?5pyL5Y+L?= <friend@example.test>\r\n'
  + 'Subject: =?UTF-8?B?5L2g5aW9?=\r\nDate: Wed, 28 Oct 2026 08:00:00 +0000\r\n'
  + 'Content-Type: multipart/alternative; boundary="sample"\r\n\r\n';
const BODY = '--sample\r\nContent-Type: text/plain; charset=UTF-8\r\n'
  + 'Content-Transfer-Encoding: quoted-printable\r\n\r\n=E6=AD=A3=E6=96=87\r\n'
  + '--sample\r\nContent-Type: text/html\r\n\r\n<p>HTML</p>\r\n--sample--\r\n';
const MIB = 1024 * 1024;

test('BODYSTRUCTURE：太大的信只选正文的纯文字、HTML 和带 Content-ID 的图，附件不抓', () => {
  const structure = '((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "QUOTED-PRINTABLE" 18 1)'
    + '("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "BASE64" 900 12) "ALTERNATIVE")'
    + '("IMAGE" "PNG" NIL "<logo@x>" NIL "BASE64" 4000 NIL ("INLINE" NIL))'
    + '("IMAGE" "JPEG" NIL NIL NIL "BASE64" 5000 NIL ("ATTACHMENT" ("FILENAME" "photo.jpg")))'
    + '("APPLICATION" "PDF" NIL NIL NIL "BASE64" 24000000 NIL ("ATTACHMENT" ("FILENAME" "fake.pdf"))) "MIXED")';
  assert.deepEqual(mailParts(`* 1 FETCH (BODYSTRUCTURE ${structure})`), [
    { path: '1.1', kind: 'plain', size: 18 },
    { path: '1.2', kind: 'html', size: 900 },
    { path: '2', kind: 'image', size: 4000 },
  ]);
  assert.deepEqual(mailParts('* 1 FETCH (BODYSTRUCTURE ("TEXT" "PLAIN" NIL NIL NIL "7BIT" 4 1))'),
    [{ path: 'TEXT', kind: 'plain', size: 4 }]);
  assert.throws(() => mailParts('* 1 FETCH (BODYSTRUCTURE ("TEXT"'));
});

const SAMPLE: FakeMessage = { uid: 7, raw: HEAD + BODY };

test('IMAP 假服务器：连接才读 gmail，最近七天、先问大小再整封 PEEK、不改已读，同一连接登出', async () => {
  const fake = await fakeImap({ validity: 9, messages: [SAMPLE] });
  const f = fixture();
  try {
    const transports = createGmailTransports({ credentials: f.credentials, connect: fake.dial,
      now: () => new Date('2026-10-28T12:00:00Z') });
    await assert.rejects(transports.imap.fetch({ credential: 'gmail' },
      { uidValidity: null, lastUid: null }, AbortSignal.timeout(2_000)), /还没配置/);
    f.put();
    const result = await transports.imap.fetch({ credential: 'gmail' },
      { uidValidity: null, lastUid: null }, AbortSignal.timeout(2_000));
    assert.equal(result.uidValidity, 9);
    const mail = result.messages[0];
    assert.equal(mail?.text, '正文');
    assert.equal(mail?.html?.trim(), '<p>HTML</p>');
    assert.equal(mail?.subject, '你好');
    assert.equal(mail?.mime, true);
    assert.equal(mail?.raw?.toString('utf8'), HEAD + BODY);
    assert.ok(fake.commands.some((line) => line.includes('UID SEARCH SINCE 21-Oct-2026')));
    assert.ok(fake.commands.some((line) => line.endsWith('UID FETCH 7 (UID RFC822.SIZE)')));
    assert.ok(fake.commands.some((line) => line.endsWith('UID FETCH 7 (BODY.PEEK[])')));
    assert.ok(fake.commands.at(-1)?.includes('LOGOUT'));
    assert.ok(fake.commands.every((line) => !/STORE|DELETE|EXPUNGE|BODY\[|RFC822\)|RFC822\.TEXT/.test(line)));
  } finally {
    await fake.close();
    f.close();
  }
});

test('超过整封上限的信只抓正文和内嵌图分段，拼起来照样有 HTML 和内嵌图，附件不下载、没有原信', async () => {
  const html = '<p>大信 <img src="cid:logo@x"></p>';
  const structure = '((("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 6 1)'
    + '("TEXT" "HTML" ("CHARSET" "UTF-8") NIL NIL "7BIT" 40 1) "ALTERNATIVE")'
    + '("IMAGE" "PNG" NIL "<logo@x>" NIL "BASE64" 12 NIL ("INLINE" NIL))'
    + '("APPLICATION" "ZIP" NIL NIL NIL "BASE64" 9000000 NIL ("ATTACHMENT" ("FILENAME" "big.zip"))) "MIXED")';
  const big: FakeMessage = {
    uid: 8,
    raw: 'Message-ID: <big@example.test>\r\nFrom: a@example.test\r\nSubject: big\r\n'
      + 'Content-Type: multipart/mixed; boundary="m"\r\n\r\n(省略)',
    size: 9 * MIB,
    structure,
    sections: {
      '1.1.MIME': 'Content-Type: text/plain; charset=UTF-8\r\n\r\n',
      '1.1': '大信',
      '1.2.MIME': 'Content-Type: text/html; charset=UTF-8\r\n\r\n',
      '1.2': html,
      '2.MIME': 'Content-Type: image/png\r\nContent-ID: <logo@x>\r\nContent-Transfer-Encoding: base64\r\n\r\n',
      '2': Buffer.from('89504e47', 'hex').toString('base64'),
    },
  };
  const fake = await fakeImap({ validity: 9, messages: [big] });
  const f = fixture();
  f.put();
  try {
    const transports = createGmailTransports({ credentials: f.credentials, connect: fake.dial });
    const result = await transports.imap.fetch({ credential: 'gmail' }, { uidValidity: 9, lastUid: 7 },
      AbortSignal.timeout(2_000));
    const mail = result.messages[0];
    assert.equal(mail?.raw, null);
    assert.equal(mail?.html?.trim(), html);
    assert.equal(mail?.text, '大信');
    assert.equal(mail?.inline?.[0]?.contentId, 'logo@x');
    assert.ok(fake.commands.some((line) => line.endsWith('UID FETCH 8 (BODY.PEEK[HEADER] BODYSTRUCTURE)')));
    assert.ok(fake.commands.some((line) => line.endsWith('(BODY.PEEK[1.2.MIME] BODY.PEEK[1.2])')));
    assert.ok(fake.commands.some((line) => line.endsWith('(BODY.PEEK[2.MIME] BODY.PEEK[2])')));
    assert.ok(!fake.commands.some((line) => line.includes('BODY.PEEK[3') || line.endsWith('(BODY.PEEK[])')));
  } finally {
    await fake.close();
    f.close();
  }
});

function numbered(uid: number, id = `${uid}@example.test`, size?: number): FakeMessage {
  return { uid, raw: HEAD.replace('sample@example.test', id) + BODY, ...(size === undefined ? {} : { size }) };
}

test('IMAP 首次同步每批最多五十封，保存最大 UID 后重建同步器继续，空增量不退游标', async () => {
  const f = fixture();
  f.put();
  const t = await openTestState();
  const box = { validity: 9, messages: Array.from({ length: 53 }, (_, i) => numbered(i + 1)),
    uids: Array.from({ length: 53 }, (_, i) => 53 - i) };
  const fake = await fakeImap(box);
  const now = () => new Date('2026-10-28T12:00:00Z');
  const transport = createGmailTransports({ credentials: f.credentials, connect: fake.dial, now }).imap;
  const makeSync = () => new MailSync({ state: t.state, credentials: f.credentials, transport, now });
  const first = makeSync();
  const resumed = makeSync();
  try {
    assert.equal(await first.sync(AbortSignal.timeout(5_000)), 50);
    assert.equal(t.state.inboxSync.get()?.lastUid, 50);
    await first.stop();
    assert.equal(await resumed.sync(AbortSignal.timeout(5_000)), 3);
    assert.equal(t.state.inboxSync.get()?.lastUid, 53);
    box.uids = [53]; // IMAP 的 54:* 在邮箱最大 UID 为 53 时仍可返回 53。
    assert.equal(await resumed.sync(AbortSignal.timeout(5_000)), 0);
    assert.equal(t.state.inboxSync.get()?.lastUid, 53);
    assert.equal(t.state.inboxMessages.count({ box: 'email' }), 53);
    assert.deepEqual(fake.commands.filter((line) => line.includes('SEARCH')).map((line) => line.slice(3)), [
      'UID SEARCH SINCE 21-Oct-2026', 'UID SEARCH UID 51:*', 'UID SEARCH UID 54:*',
    ]);
    assert.equal(fake.commands.filter((line) => line.endsWith('(BODY.PEEK[])')).length, 53);
    const stored = t.state.inboxMessages.byMessageId('<1@example.test>');
    assert.match(stored?.bodyHtml ?? '', /<p>HTML<\/p>/);
    assert.deepEqual([stored?.imapUid, stored?.uidValidity, stored?.mailbox], [1, 9, 'INBOX']);
    assert.notEqual(stored?.mimeAt, null);
  } finally {
    await first.stop();
    await resumed.stop();
    await fake.close();
    await t.cleanup();
    f.close();
  }
});

test('一次收信按大小留够九十秒抓得完的那几封，剩下的下一轮接着收', async () => {
  const f = fixture();
  f.put();
  const t = await openTestState();
  const fake = await fakeImap({ validity: 9, messages: Array.from({ length: 8 }, (_, i) => numbered(i + 1,
    undefined, 6 * MIB)) });
  const now = () => new Date('2026-10-28T12:00:00Z');
  const transport = createGmailTransports({ credentials: f.credentials, connect: fake.dial, now }).imap;
  const sync = new MailSync({ state: t.state, credentials: f.credentials, transport, now });
  try {
    assert.equal(await sync.sync(AbortSignal.timeout(5_000)), 5);
    assert.equal(t.state.inboxSync.get()?.lastUid, 5);
    assert.equal(await sync.sync(AbortSignal.timeout(5_000)), 3);
    assert.equal(t.state.inboxSync.get()?.lastUid, 8);
  } finally {
    await sync.stop();
    await fake.close();
    await t.cleanup();
    f.close();
  }
});

test('IMAP 的 UIDVALIDITY 改变就重扫最近七天，按 Message-ID 去重后沿新游标增量', async () => {
  const f = fixture();
  f.put();
  const t = await openTestState();
  const box = { validity: 9, messages: [numbered(70), numbered(1, '70@example.test'), numbered(2), numbered(3)],
    uids: [70] };
  const fake = await fakeImap(box);
  const now = () => new Date('2026-10-28T12:00:00Z');
  const transport = createGmailTransports({ credentials: f.credentials, connect: fake.dial, now }).imap;
  const sync = new MailSync({ state: t.state, credentials: f.credentials, transport, now });
  try {
    assert.equal(await sync.sync(AbortSignal.timeout(5_000)), 1);
    box.validity = 10;
    box.uids = [1, 2];
    assert.equal(await sync.sync(AbortSignal.timeout(5_000)), 1);
    assert.equal(t.state.inboxSync.get()?.uidValidity, 10);
    assert.equal(t.state.inboxSync.get()?.lastUid, 2);
    box.uids = [2, 3];
    assert.equal(await sync.sync(AbortSignal.timeout(5_000)), 1);
    assert.equal(t.state.inboxMessages.count({ box: 'email' }), 3);
    assert.deepEqual(fake.commands.filter((line) => line.includes('SEARCH')).map((line) => line.slice(3)), [
      'UID SEARCH SINCE 21-Oct-2026', 'UID SEARCH SINCE 21-Oct-2026', 'UID SEARCH UID 3:*',
    ]);
  } finally {
    await sync.stop();
    await fake.close();
    await t.cleanup();
    f.close();
  }
});

test('SMTP 假服务器：多行回包、通知寄给自己、回信寄回原发件人、点转义，QUIT 后断开不重发', async () => {
  const commands: string[] = [];
  let data = false;
  const fake = await fakeServer('220 fake ready\r\n', (line, socket) => {
    commands.push(line.startsWith('AUTH') ? 'AUTH [omitted]' : line);
    if (data) {
      if (line === '.') {
        data = false;
        socket.write('250 accepted\r\n');
      }
    } else if (line.startsWith('EHLO')) {
      socket.write('250-fake\r\n250 AUTH PLAIN\r\n');
    } else if (line === 'DATA') {
      data = true;
      socket.write('354 go\r\n');
    } else {
      socket.write(line === 'QUIT' ? '221 bye\r\n' : '250 ok\r\n');
    }
  });
  const f = fixture();
  f.put();
  try {
    const { mail } = createGmailTransports({ credentials: f.credentials, connect: fake.dial });
    await mail.send({ credential: 'gmail' }, { to: SELF_MAIL_ADDRESS, subject: '提醒',
      text: '正文\n.\n最后', inReplyTo: null }, AbortSignal.timeout(2_000));
    assert.ok(commands.includes('MAIL FROM:<self@example.test>'));
    assert.ok(commands.includes('RCPT TO:<self@example.test>'));
    assert.ok(commands.includes('To: <self@example.test>'));
    assert.ok(!commands.join('\n').includes(SELF_MAIL_ADDRESS));
    assert.ok(commands.includes('..'));
    assert.equal(commands.at(-1), 'QUIT');
    // 第 113 条：站内信回复（用户点了发送）寄回原发件人。
    commands.length = 0;
    await mail.send({ credential: 'gmail' }, { to: 'someone@example.test', subject: 'Re: 周末见',
      text: '好的', inReplyTo: '<m1@example.test>' }, AbortSignal.timeout(2_000));
    assert.ok(commands.includes('MAIL FROM:<self@example.test>'));
    assert.ok(commands.includes('RCPT TO:<someone@example.test>'));
    assert.ok(commands.includes('To: <someone@example.test>'));
  } finally {
    await fake.close();
    f.close();
  }
});

test('认证失败和取消不带服务器原文或凭据，SMTP DATA 后中断是待核实', async () => {
  const f = fixture();
  f.put();
  let sending = false;
  const fake = await fakeServer('220 ready\r\n', (line, socket) => {
    if (line === 'DATA') {
      sending = true;
      socket.write('354 go\r\n');
    } else if (line === '.') {
      socket.destroy();
    } else if (!sending) {
      socket.write('250 ok\r\n');
    }
  });
  try {
    const { mail } = createGmailTransports({ credentials: f.credentials, connect: fake.dial });
    await assert.rejects(mail.send({ credential: 'gmail' }, { to: '', subject: '提醒', text: '内容',
      inReplyTo: null }, AbortSignal.timeout(2_000)), (error: unknown) => {
      assert.ok(error instanceof Error && 'code' in error && error.code === 'unknown');
      assert.ok(!error.message.includes('test-placeholder'));
      return true;
    });
    await assert.rejects(mail.send({ credential: 'gmail' }, { to: '', subject: '提醒', text: '内容',
      inReplyTo: null }, AbortSignal.abort()));
  } finally {
    await fake.close();
    f.close();
  }
});

test('SMTP DATA 后明确四百或五百响应可重试，未收齐拒收响应的断线仍待核实', async () => {
  const f = fixture();
  f.put();
  try {
    for (const response of ['450 rejected\r\n', '550 rejected\r\n', '451-first\r\n451 rejected\r\n',
      '451-incomplete\r\n']) {
      let sending = false;
      const fake = await fakeServer('220 ready\r\n', (line, socket) => {
        if (line === 'DATA') {
          sending = true;
          socket.write('354 go\r\n');
        } else if (line === '.') {
          socket.end(response);
        } else if (!sending) {
          socket.write('250 ok\r\n');
        }
      });
      try {
        const { mail } = createGmailTransports({ credentials: f.credentials, connect: fake.dial });
        await assert.rejects(mail.send({ credential: 'gmail' }, { to: '', subject: '提醒', text: '内容',
          inReplyTo: null }, AbortSignal.timeout(2_000)), (error: unknown) => {
          assert.ok(error instanceof Error && 'code' in error);
          assert.equal(error.code, response.includes('incomplete') ? 'unknown' : 'failed');
          assert.doesNotMatch(error.message, /rejected|incomplete|test-placeholder/);
          return true;
        });
      } finally {
        await fake.close();
      }
    }
  } finally {
    f.close();
  }
});
