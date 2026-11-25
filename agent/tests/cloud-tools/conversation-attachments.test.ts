import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractConversationAttachment } from '../../src/cloud-tools/conversation-attachments.ts';
import { textPdf } from './pdf-fixture.ts';

test('extracts PDF text, marks truncated plain text; bad type/garbled/cancel never fake success', async () => {
  const signal = new AbortController().signal;
  const pdf = await extractConversationAttachment('application/pdf', textPdf('Hello from a real PDF'), signal);
  assert.match(pdf.text ?? '', /Hello from a real PDF/);
  const text = await extractConversationAttachment('text/plain', Buffer.from('甲'.repeat(10_000)), signal);
  assert.equal(text.truncated, true);
  assert.equal(text.text?.length, 9_000);
  await assert.rejects(extractConversationAttachment('image/png', Buffer.from('<html>'), signal));
  await assert.rejects(extractConversationAttachment('application/pdf', textPdf('cancel'), AbortSignal.abort()));
});

test('any attachment type succeeds without extracted text so model sees filename and MIME type', async () => {
  const signal = new AbortController().signal;
  const none = { text: null, truncated: false };
  assert.deepEqual(await extractConversationAttachment('text/plain', Buffer.from([0xff]), signal), none);
  assert.deepEqual(await extractConversationAttachment('application/zip', Buffer.from('PK...'), signal), none);
  assert.deepEqual(await extractConversationAttachment('image/gif', Buffer.from('GIF89a'), signal), none);
  assert.deepEqual(await extractConversationAttachment('application/pdf', Buffer.from('not a pdf'), signal), none);
  assert.deepEqual(await extractConversationAttachment(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('broken'), signal), none);
});
