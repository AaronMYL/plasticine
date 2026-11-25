import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Workspace } from '../../src/artifacts/index.ts';
import { deviceFileTools } from '../../src/app/device-file-tools.ts';
import type { KernelTool, LineScope, ToolArgs } from '../../src/lines/index.ts';
import { tempDirectory } from '../state/helpers.ts';

const SCOPE: LineScope = { lineId: 'line-1', kind: 'background', projectId: null };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let dir: Awaited<ReturnType<typeof tempDirectory>>;
let workspace: Workspace;
let sent: { callId: string; args: ToolArgs }[];

const deviceAction: KernelTool = {
  name: 'device_action', say: () => '设备动作', hardLine: () => null,
  create: () => ({ name: 'device_action', label: '设备动作', description: '', parameters: {} as never,
    async execute(callId, args) {
      sent.push({ callId, args: args as ToolArgs });
      return { content: [{ type: 'text', text: '{"status":"executed"}' }], details: {} };
    } }),
};

function tool(name: string): KernelTool {
  const tools = deviceFileTools(deviceAction, workspace, (actionId) => {
    if (actionId !== 'line:line-1:get-1') throw new Error('没有这次动作');
    return PNG;
  });
  const found = tools.find((candidate) => candidate.name === name);
  assert.ok(found);
  return found;
}

async function run(name: string, args: Record<string, unknown>, callId: string) {
  const result = await tool(name).create(SCOPE).execute(callId, args, new AbortController().signal);
  const text = result.content[0];
  assert.ok(text?.type === 'text');
  return JSON.parse(text.text) as Record<string, unknown>;
}

beforeEach(async () => {
  dir = await tempDirectory();
  workspace = new Workspace(dir.directory, () => new Date('2026-11-16T08:00:00Z'));
  sent = [];
});

afterEach(async () => {
  await dir.cleanup();
});

test('tab_upload reads file-page content for device_action while model supplies only path', async () => {
  workspace.mkdir('简历');
  workspace.upload('简历', '示例简历.pdf', Buffer.from('%PDF-1.4 示例'), false);
  workspace.upload('', '配图.png', PNG, false);
  await run('tab_upload', { nodeId: 'mac-1', purpose: '把示例简历传到招聘网站的附件框', tabId: 't-1', version: 'v1',
    n: 4, paths: ['简历/示例简历.pdf', '配图.png'] }, 'up-1');
  assert.equal(sent.length, 1);
  const action = sent[0]?.args['action'] as Record<string, unknown>;
  assert.equal(action['kind'], 'tab_upload');
  assert.equal(action['n'], 4);
  const files = action['files'] as { name: string; mimeType: string; base64: string }[];
  assert.deepEqual(files.map((file) => [file.name, file.mimeType]),
    [['示例简历.pdf', 'application/pdf'], ['配图.png', 'image/png']]);
  assert.equal(Buffer.from(files[1]?.base64 ?? '', 'base64').equals(PNG), true);
  assert.equal(sent[0]?.callId, 'up-1');
});

test('device_file_put uploads from files page; device_file_get saves fetched file to files page', async () => {
  workspace.upload('', '表.csv', Buffer.from('a,b\n'), false);
  await run('device_file_put', { nodeId: 'mac-1', purpose: '把表放到桌面', from: '表.csv', to: '~/Desktop/表.csv' },
    'put-1');
  assert.deepEqual(sent[0]?.args['action'], { kind: 'file_put', path: '~/Desktop/表.csv',
    base64: Buffer.from('a,b\n').toString('base64'), overwrite: false });
  const got = await run('device_file_get', { nodeId: 'mac-1', purpose: '拿 Mac 上的照片来发帖',
    path: '~/Pictures/a.png', saveTo: '发帖/a.png' }, 'get-1');
  assert.deepEqual(sent[1]?.args['action'], { kind: 'file_fetch', path: '~/Pictures/a.png' });
  assert.equal(got['saved'], '发帖/a.png');
  assert.equal(workspace.stat('发帖/a.png').bytes, PNG.length);
});

test('missing or empty files-page item returns clear message without dispatching device action', async () => {
  await assert.rejects(run('tab_upload', { nodeId: 'mac-1', purpose: '上传一份不存在的', tabId: 't-1', version: 'v1',
    n: 1, paths: ['没有.pdf'] }, 'up-2'), /没有「没有.pdf」/);
  workspace.upload('', '空.txt', Buffer.alloc(0), false);
  await assert.rejects(run('device_file_put', { nodeId: 'mac-1', purpose: '放一个空文件', from: '空.txt',
    to: '~/Desktop/空.txt' }, 'put-2'), /空文件/);
  assert.equal(sent.length, 0);
});
