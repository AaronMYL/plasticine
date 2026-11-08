import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractConversationAttachment } from '../../src/cloud-tools/conversation-attachments.ts';
import { textPdf } from './pdf-fixture.ts';

test('PDF 真抽字、纯文本标截断；错误类型、乱码与取消不假称已读', async () => {
  const signal = new AbortController().signal;
  const pdf = await extractConversationAttachment('application/pdf', textPdf('Hello from a real PDF'), signal);
  assert.match(pdf.text ?? '', /Hello from a real PDF/);
  const text = await extractConversationAttachment('text/plain', Buffer.from('甲'.repeat(10_000)), signal);
  assert.equal(text.truncated, true);
  assert.equal(text.text?.length, 9_000);
  await assert.rejects(extractConversationAttachment('image/png', Buffer.from('<html>'), signal));
  await assert.rejects(extractConversationAttachment('text/plain', Buffer.from([0xff]), signal));
  await assert.rejects(extractConversationAttachment('application/pdf', textPdf('cancel'), AbortSignal.abort()));
});
