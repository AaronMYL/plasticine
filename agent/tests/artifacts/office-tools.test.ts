// file_make、file_convert、image_generate、image_edit、audio_transcribe（11-16）：参数怎么校验、读写文件页、回什么。
// 打印 PDF、ffmpeg、出图、转写都给假的。

import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { mediaTools, officeTools, pathForMime, Workspace, type MediaToolParts } from '../../src/artifacts/index.ts';
import { officeText, xlsxSheets } from '../../src/cloud-tools/index.ts';
import type { KernelTool, LineScope } from '../../src/lines/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const SCOPE: LineScope = { lineId: 'main', kind: 'main', projectId: null };
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000001000000008080200000000', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'), Buffer.alloc(20)]);

let h: TestState;
let workspace: Workspace;
let printed: string[];
let drawn: Awaited<ReturnType<MediaToolParts['draw']>>;
let edits: { inputs: string[]; ops: unknown[]; output: string; options: unknown }[];
let converted: string[];
let levelings: string[];

function tools(): KernelTool[] {
  return [
    ...officeTools({ workspace, officeText, xlsxSheets,
      printPdf: async (html) => {
        printed.push(html);
        return Buffer.from('%PDF-1.7 假的');
      },
      pdfText: async () => 'PDF 里的字',
      convertMedia: async (input, output) => {
        converted.push(`${input.extension}->${output}`);
        return output === 'webp' ? WEBP : PNG;
      } }),
    ...mediaTools({ workspace,
      editImage: async (inputs, ops, output, _signal, options) => {
        edits.push({ inputs: inputs.map((input) => input.extension), ops, output, options });
        return PNG;
      },
      draw: async () => drawn,
      transcribe: async (input) => {
        levelings.push(input.leveling ?? 'default');
        return { text: `[00:00] 录音（${input.extension}）`, seconds: 3, engine: 'sensevoice',
          coverage: '转出 1 句；这次没拉平音量。' };
      } }),
  ];
}

async function run(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = tools().find((candidate) => candidate.name === name);
  assert.ok(tool, name);
  const result = await tool.create(SCOPE).execute('c1', args, new AbortController().signal);
  const text = result.content[0];
  assert.ok(text?.type === 'text');
  return JSON.parse(text.text) as Record<string, unknown>;
}

beforeEach(async () => {
  h = await openTestState();
  workspace = new Workspace(dirname(h.path), () => new Date('2026-11-16T08:00:00Z'));
  printed = [];
  edits = [];
  converted = [];
  levelings = [];
  drawn = { data: PNG, mime: 'image/png' };
});

afterEach(async () => {
  await h.cleanup();
});

test('file_make：Word 从 Markdown 来（图按文件页的路径放），Excel 从几张表来，PDF 走打印', async () => {
  workspace.mkdir('图');
  workspace.upload('图', 'a.png', PNG, false);
  const docx = await run('file_make', { path: '报告/周报.docx', markdown: '# 周报\n\n这周做完了。\n\n![图](图/a.png)' });
  assert.equal(docx['path'], '报告/周报.docx');
  const saved = workspace.read('报告/周报.docx').data;
  assert.match(officeText('docx', saved) ?? '', /周报\n这周做完了。/);
  assert.ok(saved.includes(Buffer.from('word/media/image1.png')));
  await run('file_make', { path: '名单.xlsx', sheets: [{ name: '名单', rows: [['名字', '城市'], ['示例甲', '成都']] }] });
  assert.deepEqual(xlsxSheets(workspace.read('名单.xlsx').data)?.[0]?.rows, [['名字', '城市'], ['示例甲', '成都']]);
  await run('file_make', { path: '名单.csv', sheets: [{ name: '名单', rows: [['a', 1]] }] });
  assert.equal(workspace.read('名单.csv').data.toString('utf8'), '\ufeffa,1\r\n');
  await run('file_make', { path: '报告.pdf', markdown: '# 报告', title: '月报' });
  assert.match(printed[0] ?? '', /<title>月报<\/title>/);
  await run('file_make', { path: '讲.pptx', slides: [{ title: '第一页', bullets: ['一'], image: '图/a.png' }] });
  assert.match(officeText('pptx', workspace.read('讲.pptx').data) ?? '', /第一页\n一/);
});

test('file_make 缺内容、格式不认：说清楚，不存', async () => {
  await assert.rejects(run('file_make', { path: 'a.docx', sheets: [{ name: 'x', rows: [] }] }), /要给 markdown/);
  await assert.rejects(run('file_make', { path: 'a.xlsx', markdown: '# x' }), /要给 sheets/);
  await assert.rejects(run('file_make', { path: 'a.html', markdown: '# x' }), /生成不了 \.html/);
  workspace.upload('', 'not.txt', Buffer.from('文字'), false);
  await assert.rejects(run('file_make', { path: 'b.pptx', slides: [{ title: 'x', image: 'not.txt' }] }),
    /不是 png 或 jpg/);
  assert.equal(workspace.list('').entries.filter((entry) => entry.kind === 'file').length, 1);
});

test('file_convert：Markdown → Word，CSV → Excel，图片交给 ffmpeg；原文件不动，同名不给 overwrite 不换', async () => {
  workspace.upload('', '稿子.md', Buffer.from('# 标题\n\n一段'), false);
  const word = await run('file_convert', { from: '稿子.md', to: '稿子.docx' });
  assert.equal(word['path'], '稿子.docx');
  assert.equal(officeText('docx', workspace.read('稿子.docx').data), '标题\n一段');
  assert.equal(workspace.readText('稿子.md').text, '# 标题\n\n一段');
  workspace.upload('', '名单.csv', Buffer.from('名字,数量\n示例甲,3\n'), false);
  await run('file_convert', { from: '名单.csv', to: '名单.xlsx' });
  assert.deepEqual(xlsxSheets(workspace.read('名单.xlsx').data)?.[0]?.rows, [['名字', '数量'], ['示例甲', '3']]);
  workspace.upload('', '截图.png', PNG, false);
  await run('file_convert', { from: '截图.png', to: '截图.webp' });
  assert.deepEqual(converted, ['png->webp']);
  assert.ok(workspace.read('截图.webp').data.equals(WEBP));
  await assert.rejects(run('file_convert', { from: '稿子.md', to: '稿子.xlsx' }), /文档转不成 \.xlsx/);
  await assert.rejects(run('file_convert', { from: '名单.csv', to: '稿子.docx' }), /overwrite/);
});

test('image_edit：几张图拼起来再按顺序做，存成要的格式；不是图的不改', async () => {
  workspace.upload('', 'a.png', PNG, false);
  workspace.upload('', 'b.png', PNG, false);
  const done = await run('image_edit', { from: ['a.png', 'b.png'], to: '拼图.png', join: 'vertical',
    ops: [{ op: 'blur', x: 0, y: 0, width: 4, height: 4 }, { op: 'text', text: '封面', x: 1, y: 1 }] });
  assert.deepEqual(done, { path: '拼图.png', bytes: PNG.length, width: 16, height: 8 });
  assert.deepEqual(edits[0]?.inputs, ['png', 'png']);
  assert.equal(edits[0]?.output, 'png');
  assert.deepEqual(edits[0]?.options, { join: 'vertical' });
  workspace.upload('', 'n.txt', Buffer.from('字'), false);
  await assert.rejects(run('image_edit', { from: 'n.txt', to: 'x.png', ops: [] }), /不是图片/);
  await assert.rejects(run('image_edit', { from: 'a.png', to: 'x.gif', ops: [] }), /png、jpg 或 webp/);
});

test('image_generate：扩展名照出来的图改；没模型说清楚', async () => {
  drawn = { data: WEBP, mime: 'image/webp' };
  const done = await run('image_generate', { prompt: '一只橘猫坐在窗台', path: '封面/第三期.png' });
  assert.equal(done['path'], '封面/第三期.webp');
  assert.equal(pathForMime('头像', 'image/jpeg'), '头像.jpg');
  drawn = { error: '没有能出图的模型' };
  await assert.rejects(run('image_generate', { prompt: '猫', path: 'x.png' }), /没画出来：没有能出图的模型/);
});

test('audio_transcribe：音视频转成逐字稿回给模型，saveTo 存一份；别的类型不转', async () => {
  workspace.upload('', '录音.m4a', Buffer.from('音频'), false);
  const done = await run('audio_transcribe', { path: '录音.m4a', saveTo: '逐字稿/录音.txt' });
  assert.equal(done['text'], '[00:00] 录音（m4a）');
  assert.equal(done['saved'], '逐字稿/录音.txt');
  assert.equal(workspace.readText('逐字稿/录音.txt').text, '[00:00] 录音（m4a）');
  workspace.upload('', 'a.md', Buffer.from('字'), false);
  await assert.rejects(run('audio_transcribe', { path: 'a.md' }), /不是音频或视频/);
  assert.equal(done['coverage'], '转出 1 句；这次没拉平音量。', '结果带「转出来多少」');
  await run('audio_transcribe', { path: '录音.m4a', leveling: 'on' });
  assert.deepEqual(levelings, ['default', 'on'], 'AI 能指定拉平那一档，不指定由转写那边按默认（auto）');
  await assert.rejects(run('audio_transcribe', { path: '录音.m4a', leveling: 'loud' }));
});
