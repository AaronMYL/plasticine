import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { attachmentReadTool } from '../../src/lines/index.ts';
import { imagesOf } from '../../src/lines/images.ts';
import { userMessage } from '../../src/lines/messages.ts';
import { openTestState } from '../state/helpers.ts';

function stored(state: Awaited<ReturnType<typeof openTestState>>['state'], requestId: string, name: string,
  mimeType: string, data: Buffer, text: string | null): string {
  const row = state.attachments.open({ requestId, name, mimeType, bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex') }, 'library-user');
  state.attachments.storeBytes(row.id, data);
  state.attachments.finish(row.id, { text, truncated: false, error: null });
  return row.id;
}

async function run(tool: ReturnType<typeof attachmentReadTool>, id: string): Promise<Record<string, unknown>> {
  const result = await tool.create({ lineId: 'line-main' } as never).execute('call-1', { id });
  const part = result.content[0];
  assert.equal(part?.type, 'text');
  return JSON.parse(part.type === 'text' ? part.text : '{}') as Record<string, unknown>;
}

test('attachment_read returns text if readable, metadata for archives, clear error for missing ID', async () => {
  const handle = await openTestState();
  try {
    const { state } = handle;
    const xlsx = stored(state, 'read-xlsx', '投递记录.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('PK'), '## 投递\n甲公司\t已投');
    const zip = stored(state, 'read-zip', '全部素材.zip', 'application/zip', Buffer.from('PK zip'), null);
    const tool = attachmentReadTool(state);
    assert.equal(tool.say({ id: xlsx }), '读附件：投递记录.xlsx');
    assert.equal(tool.say({ id: 'nope' }), '读附件');
    assert.deepEqual(await run(tool, xlsx), { untrustedMaterial: true, name: '投递记录.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: 2,
      text: '## 投递\n甲公司\t已投', truncated: false });
    const archive = await run(tool, zip);
    assert.equal(archive['text'], null);
    assert.match(String(archive['note']), /只知道名字、类型和大小/);
    await assert.rejects(run(tool, 'nope'), /没有这份附件/);
  } finally {
    await handle.cleanup();
  }
});

test('attachment prompt instructs attachment_read; only PNG, JPEG, and WebP pass to model as images', async () => {
  const handle = await openTestState();
  try {
    const { state } = handle;
    const note = userMessage('看看', [{ id: 'a1', name: '截图.png' }], 0);
    assert.match(JSON.stringify(note.content), /正文用 attachment_read 读/);
    const gif = stored(state, 'read-gif', '动图.gif', 'image/gif', Buffer.from('GIF89a'), null);
    assert.deepEqual(imagesOf(state, [gif]), []);
  } finally {
    await handle.cleanup();
  }
});
