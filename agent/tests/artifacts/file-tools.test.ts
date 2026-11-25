import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { Value } from 'typebox/value';
import { MessageWidgetSchema } from '../../shared/api/message-widgets.ts';
import { fileTools, Workspace, type FileToolParts } from '../../src/artifacts/index.ts';
import type { KernelTool, LineScope } from '../../src/lines/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const OWNER = 'library-user';
const SCOPE: LineScope = { lineId: 'main', kind: 'main', projectId: null };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let h: TestState;
let workspace: Workspace;
let downloads: string[];

function parts(): FileToolParts {
  return { workspace, state: h.state, attachmentOwner: OWNER,
    deviceFile: (actionId) => {
      if (actionId !== 'line:main:shot') throw new Error('没有这次截图');
      return PNG;
    },
    download: async (url) => {
      downloads.push(url);
      return { data: PNG, type: 'image/png' };
    } };
}

function tool(name: string): KernelTool {
  const found = fileTools(parts()).find((candidate) => candidate.name === name);
  assert.ok(found, name);
  return found;
}

async function run(name: string, args: Record<string, unknown>, callId = 'c1') {
  const result = await tool(name).create(SCOPE).execute(callId, args, new AbortController().signal);
  const text = result.content[0];
  assert.ok(text?.type === 'text');
  return { value: JSON.parse(text.text) as Record<string, unknown>,
    details: result.details as Record<string, unknown> };
}

beforeEach(async () => {
  h = await openTestState();
  workspace = new Workspace(dirname(h.path), () => new Date('2026-11-16T08:00:00Z'));
  downloads = [];
});

afterEach(async () => {
  await h.cleanup();
});

test('file_save creates missing folders and succeeds idempotently on identical content', async () => {
  const saved = await run('file_save', { path: '导出/名单.csv', text: '名字,城市\n示例甲,成都\n' });
  assert.equal(saved.value['path'], '导出/名单.csv');
  assert.equal(workspace.readText('导出/名单.csv').text, '名字,城市\n示例甲,成都\n');
  const again = await run('file_save', { path: '导出/名单.csv', text: '名字,城市\n示例甲,成都\n' });
  assert.equal(again.value['path'], '导出/名单.csv');
});

test('file_save with different content skips without overwrite; with overwrite trashes old file', async () => {
  await run('file_save', { path: '周报.md', text: '# 第一版' });
  await assert.rejects(run('file_save', { path: '周报.md', text: '# 第二版' }), /overwrite/);
  assert.equal(workspace.readText('周报.md').text, '# 第一版');
  const replaced = await run('file_save', { path: '周报.md', text: '# 第二版', overwrite: true });
  assert.ok(String(replaced.value['note']).includes('最近删除'));
  assert.equal(workspace.readText('周报.md').text, '# 第二版');
  assert.deepEqual(workspace.trashed().map((entry) => entry.originalPath), ['周报.md']);
});

test('file_save requires matching source, rejects type/content mismatch, delegates URL to download', async () => {
  await assert.rejects(run('file_save', { path: 'a.txt', text: 'x', base64: 'eA==' }), /只给一样/);
  await assert.rejects(run('file_save', { path: '图.png', text: '不是图' }), /对不上/);
  await assert.rejects(run('file_save', { path: '脚本.sh', text: 'echo' }), /不收/);
  await run('file_save', { path: '图/官网.png', fromUrl: 'https://example.com/a.png' });
  assert.deepEqual(downloads, ['https://example.com/a.png']);
  assert.equal(workspace.stat('图/官网.png').bytes, PNG.length);
  await run('file_save', { path: '图/编码.png', base64: PNG.toString('base64') });
  assert.equal(workspace.stat('图/编码.png').bytes, PNG.length);
  await run('file_save', { path: '图/截图.png', fromDeviceAction: 'line:main:shot' });
  assert.equal(workspace.stat('图/截图.png').bytes, PNG.length);
  await assert.rejects(run('file_save', { path: '图/没有.png', fromDeviceAction: 'line:main:nope' }), /没有这次截图/);
});

test('file_save from chat attachment requires owned, completed upload', async () => {
  const row = h.state.attachments.open({ requestId: 'file-tools-att-1', name: '截图.png', mimeType: 'image/png',
    bytes: PNG.length, sha256: createHash('sha256').update(PNG).digest('hex') }, OWNER);
  await assert.rejects(run('file_save', { path: '截图.png', fromAttachment: row.id }), /读不到原件/);
  h.state.attachments.storeBytes(row.id, PNG);
  h.state.attachments.finish(row.id, { text: null, truncated: false, error: null });
  await run('file_save', { path: '截图.png', fromAttachment: row.id });
  assert.equal(workspace.stat('截图.png').bytes, PNG.length);
});

test('reply_files attaches file-page item to reply; replay returns same; later edits unaffected', async () => {
  workspace.upload('', '名单.csv', Buffer.from('名字\n示例乙\n'), false);
  workspace.upload('', '图.png', PNG, false);
  const first = await run('reply_files', { paths: ['名单.csv', '图.png'] }, 'call-r');
  const widgets = first.details['widgets'] as Record<string, unknown>[];
  assert.equal(widgets.length, 2);
  for (const widget of widgets) assert.ok(Value.Check(MessageWidgetSchema, widget), JSON.stringify(widget));
  assert.deepEqual(widgets.map((widget) => [widget['kind'], widget['name'], widget['mimeType']]),
    [['file', '名单.csv', 'text/csv'], ['file', '图.png', 'image/png']]);
  const attachmentId = String(widgets[0]?.['attachmentId']);
  assert.equal(h.state.attachments.readBytes(attachmentId).toString('utf8'), '名字\n示例乙\n');
  const replay = await run('reply_files', { paths: ['名单.csv', '图.png'] }, 'call-r');
  assert.deepEqual(replay.details['widgets'], widgets);
  workspace.writeText('名单.csv', '改过了', workspace.readText('名单.csv').version);
  assert.equal(h.state.attachments.readBytes(attachmentId).toString('utf8'), '名字\n示例乙\n');
});

test('reply_files reports clear message for missing or empty file', async () => {
  await assert.rejects(run('reply_files', { paths: ['不存在.md'] }), /没有「不存在.md」/);
  workspace.upload('', '空.txt', Buffer.alloc(0), false);
  await assert.rejects(run('reply_files', { paths: ['空.txt'] }), /空文件/);
});
