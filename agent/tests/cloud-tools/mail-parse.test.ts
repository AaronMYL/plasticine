import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeHeaderWords } from '../../src/cloud-tools/mail-words.ts';
import { parseMail } from '../../src/cloud-tools/mail-parse.ts';

function raw(lines: readonly (string | Buffer)[]): Buffer {
  return Buffer.concat(lines.map((line) => Buffer.concat([typeof line === 'string' ? Buffer.from(line) : line,
    Buffer.from('\r\n')])));
}

const HEAD = [
  'Message-ID: <sample@example.test>',
  'From: =?UTF-8?B?5pyL5Y+L?= <friend@example.test>',
  'To: =?UTF-8?B?5oiR?= <me@example.test>',
  'Subject: =?UTF-8?B?5L2g5aW9?=',
  'Date: Wed, 28 Oct 2026 08:00:00 +0000',
  'MIME-Version: 1.0',
];

test('multipart/alternative uses plain part for search, keeps HTML, decodes subject/from/to', async () => {
  const mail = await parseMail(raw([...HEAD,
    'Content-Type: multipart/alternative; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '',
    '=E6=AD=A3=E6=96=87', '',
    '--b1', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('<p>正文 <b>加粗</b></p>').toString('base64'),
    '--b1--', '']));
  assert.equal(mail.messageId, '<sample@example.test>');
  assert.equal(mail.subject, '你好');
  assert.equal(mail.fromAddress, 'friend@example.test');
  assert.equal(mail.fromName, '朋友');
  assert.equal(mail.toAddress, '我 <me@example.test>');
  assert.equal(mail.text, '正文');
  assert.equal(mail.html, '<p>正文 <b>加粗</b></p>');
});

test('decodes GBK body and charset parameters with spaces and quotes', async () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7]);
  const mail = await parseMail(raw([...HEAD, 'Content-Type: text/plain; charset = "GBK"',
    'Content-Transfer-Encoding: 8bit', '', gbk]));
  assert.equal(mail.text, '你好，世界');
  assert.equal(mail.html, null);
});

test('reassembles CJK character split across two base64 encoded-words without replacement char', () => {
  assert.equal(decodeHeaderWords('=?UTF-8?B?5L2g5Q==?= =?UTF-8?B?pb0=?='), '你好');
  assert.equal(decodeHeaderWords('=?utf-8?Q?=E4=BD=A0=E5?=\r\n =?utf-8?Q?=A5=BD?= 吗'), '你好 吗');
  assert.equal(decodeHeaderWords('前 =?GBK?B?xOO6ww==?= 后'), '前 你好 后');
  assert.equal(decodeHeaderWords('没有编码词'), '没有编码词');
  assert.equal(decodeHeaderWords('=?UTF-8?B?5L2g?= =?GBK?B?usM=?='), '你好');
});

test('decodes sender display name split across multiple encoded-words', async () => {
  const mail = await parseMail(raw(['From: =?UTF-8?B?5L2g5Q==?= =?UTF-8?B?pb0=?= <a@example.test>',
    'Subject: =?UTF-8?B?5L2g5Q==?= =?UTF-8?B?pb0=?=', 'Content-Type: text/plain; charset=utf-8', '', 'x']));
  assert.equal(mail.fromName, '你好');
  assert.equal(mail.subject, '你好');
});

test('HTML-only email converts to text restoring entities, preserving paragraphs, stripping ZWSP', async () => {
  const html = '<html><head><style>p{color:red}</style></head><body>'
    + '<p>&#20320;&#x597D;&nbsp;&quot;Hi&quot; &amp; &copy;&hellip;</p><p>第二段&zwnj;&#8204;​͏</p></body></html>';
  const mail = await parseMail(raw([...HEAD, 'Content-Type: text/html; charset=utf-8', '', html]));
  assert.equal(mail.text, '你好 "Hi" & ©…\n\n第二段');
  assert.equal(mail.html?.trim(), html);
});

test('plain-text part containing full HTML document is rendered as HTML', async () => {
  const page = '<!DOCTYPE html><html><head><style>.a{margin:0}</style></head><body><div class="a">'
    + '<p>Your ride</p><p>Total &euro;12</p></div></body></html>';
  const mail = await parseMail(raw([...HEAD, 'Content-Type: text/plain; charset=utf-8', '', page]));
  assert.equal(mail.html?.trim(), page);
  assert.equal(mail.text, 'Your ride\n\nTotal €12');
});

test('keeps inline images by Content-ID, lists attachment names, names unnamed invites invite.ics', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const mail = await parseMail(raw([...HEAD, 'Content-Type: multipart/mixed; boundary="m"', '',
    '--m', 'Content-Type: multipart/related; boundary="r"', '',
    '--r', 'Content-Type: text/html; charset=utf-8', '', '<p><img src="cid:logo@x"></p>',
    '--r', 'Content-Type: image/png', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '',
    png.toString('base64'),
    '--r--',
    '--m', 'Content-Type: text/calendar; method=REQUEST; charset=utf-8', '', 'BEGIN:VCALENDAR', 'END:VCALENDAR',
    '--m', 'Content-Type: application/pdf; name="=?UTF-8?B?5oql5Lu3LnBkZg==?="',
    'Content-Disposition: attachment; filename="=?UTF-8?B?5oql5Lu3LnBkZg==?="', 'Content-Transfer-Encoding: base64',
    '', Buffer.from('%PDF').toString('base64'),
    '--m--', '']));
  assert.equal(mail.inline.length, 1);
  assert.equal(mail.inline[0]?.contentId, 'logo@x');
  assert.equal(mail.inline[0]?.type, 'image/png');
  assert.deepEqual(mail.inline[0]?.data, png);
  assert.deepEqual(mail.attachments, ['invite.ics', '报价.pdf']);
});

test('email without body returns empty text without throwing', async () => {
  const mail = await parseMail(raw(['From: a@example.test', 'Subject: x', '', '']));
  assert.equal(mail.text, '');
  assert.equal(mail.html, null);
  assert.equal(mail.fromName, null);
  assert.equal(mail.toAddress, null);
});
