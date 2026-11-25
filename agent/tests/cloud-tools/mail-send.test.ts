import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMailSendTool, type MailSender, type OutgoingMail } from '../../src/cloud-tools/index.ts';
import { smtpMessage } from '../../src/cloud-tools/mail-protocol.ts';
import { toolContext } from '../tools/helpers.ts';

test('email headers include To/Cc, base64 multipart attachments, and RFC 2047 CJK filenames', () => {
  const data = smtpMessage({ from: 'me@example.com', to: ['a@example.com', 'b@example.com'], cc: ['c@example.com'],
    subject: '简历', text: '你好\n.开头的一行', inReplyTo: null,
    attachments: [{ name: '简历.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4') }] });
  assert.match(data, /^To: <a@example\.com>, <b@example\.com>\r$/m);
  assert.match(data, /^Cc: <c@example\.com>\r$/m);
  assert.match(data, /Content-Type: multipart\/mixed; boundary="plasticine-/);
  assert.ok(data.includes(`filename="=?UTF-8?B?${Buffer.from('简历.pdf').toString('base64')}?="`));
  assert.ok(data.includes(Buffer.from('%PDF-1.4').toString('base64')));
  assert.ok(data.includes('\r\n..开头的一行'));
  assert.ok(data.endsWith('\r\n.\r\n'));
  assert.throws(() => smtpMessage({ from: 'me@example.com', to: ['a@example.com\r\nBcc: x@example.com'], cc: [],
    subject: 's', text: 't', inReplyTo: null, attachments: [] }));
});

test('mail_send passes To/Cc/Bcc/attachments, dedupes lowercased grant recipients, errors if unset', async () => {
  const sent: OutgoingMail[] = [];
  let configured = true;
  const sender: MailSender = { configured: () => configured, send: async (mail) => { sent.push(mail); } };
  const tool = createMailSendTool({ sender, readFile: (path) => ({ name: path, type: 'application/pdf',
    data: Buffer.from('%PDF') }) });
  const args = { to: ['A@example.com', 'b@example.com'], cc: ['a@example.com'], bcc: ['d@example.com'],
    subject: '报价', text: '见附件', attachments: ['报价.pdf'] };
  assert.deepEqual(tool.outbound?.(args)?.recipients, ['a@example.com', 'b@example.com', 'd@example.com']);
  const result = JSON.parse(await tool.execute(args, toolContext('m1'))) as Record<string, unknown>;
  assert.equal(result['sent'], true);
  assert.equal(sent[0]?.to, 'A@example.com');
  assert.deepEqual(sent[0]?.moreTo, ['b@example.com']);
  assert.deepEqual(sent[0]?.bcc, ['d@example.com']);
  assert.equal(sent[0]?.attachments?.[0]?.name, '报价.pdf');
  configured = false;
  await assert.rejects(tool.execute(args, toolContext('m2')),
    (error: Error & { content?: string }) => /还没配发信的邮箱/.test(error.content ?? ''));
});
