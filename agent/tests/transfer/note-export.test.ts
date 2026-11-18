import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { exportNotes, importNotes } from '../../src/transfer/index.ts';
import { openZip } from '../../src/util/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/'
  + 'iZk9HQAAAABJRU5ErkJggg==', 'base64');

beforeEach(async () => {
  t = await openTestState();
});
afterEach(async () => {
  await t.cleanup();
});

const create = (markdown: string, folder = '笔记') => t.state.notes.create({ markdown, folder, author: 'user' });
const text = (data: Buffer | null | undefined): string => data?.toString('utf8') ?? '';

test('一篇没有图的笔记导出成一个 .md：文件名是标题，开头带创建和修改时间', () => {
  const note = create('# 周末 / 计划\n\n去西湖');
  const saved = t.state.notes.save(note.id, note.version, { markdown: '# 周末 / 计划\n\n去西湖，带相机' });
  const file = exportNotes(t.state, [note.id]);
  assert.equal(file.name, '周末 计划.md');
  assert.equal(file.type, 'text/markdown; charset=utf-8');
  assert.equal(text(file.data), `---\ncreated: ${note.createdAt}\nupdated: ${saved.updatedAt}\n---\n\n`
    + '# 周末 / 计划\n\n去西湖，带相机\n');
});

test('一篇带图的笔记导出成 zip：图放进 assets，正文里改成相对路径；没读到的图照原样留着', () => {
  const asset = t.state.notes.writeAsset(PNG, 'image/png');
  const note = create(`# 带图\n\n![一张](/v2/notes/assets/${asset.name})\n\n![旧的](/v1/notes/assets/gone.png)`);
  const file = exportNotes(t.state, [note.id]);
  assert.equal(file.name, '带图.zip');
  assert.equal(file.type, 'application/zip');
  const zip = openZip(file.data)!;
  assert.deepEqual(zip.names().sort(), [`assets/${asset.name}`, '带图.md']);
  assert.deepEqual(zip.read(`assets/${asset.name}`), PNG);
  assert.match(text(zip.read('带图.md')), new RegExp(`!\\[一张\\]\\(assets/${asset.name}\\)`));
  assert.match(text(zip.read('带图.md')), /!\[旧的\]\(\/v1\/notes\/assets\/gone\.png\)/);
});

test('多篇打成一个 zip：按文件夹分目录，重名的排号，图跟着各自的文件夹', () => {
  const asset = t.state.notes.writeAsset(PNG, 'image/png');
  const first = create('# 计划\n\n第一篇');
  const second = create('# 计划\n\n第二篇');
  const work = create(`# 周报\n\n![图](/v2/notes/assets/${asset.name})`, '工作');
  const file = exportNotes(t.state, [first.id, second.id, work.id]);
  assert.equal(file.name, 'Plasticine 笔记（3 篇）.zip');
  const zip = openZip(file.data)!;
  assert.deepEqual(zip.names().sort(), [`工作/assets/${asset.name}`, '工作/周报.md', '笔记/计划 2.md', '笔记/计划.md'].sort());
  assert.match(text(zip.read('笔记/计划 2.md')), /第二篇/);
  assert.match(text(zip.read('工作/周报.md')), new RegExp(`\\(assets/${asset.name}\\)`));
});

test('导出的 .md 再导入回来：正文、图的链接和时间都和原来一样', () => {
  const asset = t.state.notes.writeAsset(PNG, 'image/png');
  const note = create(`# 原样回来\n\n![图](/v2/notes/assets/${asset.name})\n\n正文`);
  const zip = openZip(exportNotes(t.state, [note.id]).data)!;
  const back = importNotes(t.state, [{ name: '原样回来.md', data: zip.read('原样回来.md')! }],
    { folder: '笔记', author: 'user', now: () => new Date('2027-01-01T00:00:00.000Z') }).imported[0]!;
  assert.equal(t.state.notes.readBody(back), t.state.notes.readBody(note));
  assert.equal(back.createdAt, note.createdAt);
  assert.equal(back.updatedAt, note.updatedAt);
  assert.notEqual(back.id, note.id);
});

test('没有这篇笔记就报错，不给一个缺了的包', () => {
  const note = create('# 在的');
  assert.throws(() => exportNotes(t.state, [note.id, 'missing']), /找不到|not_found|没有/);
});
