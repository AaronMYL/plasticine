import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { NOTE_MAX_CHARS } from '../../shared/state.ts';
import { importNotes } from '../../src/transfer/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
const NOW = new Date('2026-11-18T08:00:00.000Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/'
  + 'iZk9HQAAAABJRU5ErkJggg==', 'base64');

beforeEach(async () => {
  t = await openTestState();
});
afterEach(async () => {
  await t.cleanup();
});

const file = (name: string, text: string) => ({ name, data: Buffer.from(text, 'utf8') });
const run = (files: { name: string; data: Buffer }[], folder = '笔记') =>
  importNotes(t.state, files, { folder, author: 'user', now: () => NOW });
const body = (id: string): string => t.state.notes.readBody(t.state.notes.require(id));

test('Markdown 第一行是标题就照原样；不是就把文件名当标题；都进指定的文件夹、记成用户写的', () => {
  const result = run([file('周末.md', '# 去西湖\n\n带相机'), file('采购清单.markdown', '牛奶\n\n- 鸡蛋')], '生活');
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.imported.map((note) => [note.title, note.folder, note.author]),
    [['去西湖', '生活', 'user'], ['采购清单', '生活', 'user']]);
  assert.equal(body(result.imported[0]!.id), '# 去西湖\n\n带相机');
  assert.equal(body(result.imported[1]!.id), '# 采购清单\n\n牛奶\n\n- 鸡蛋');
});

test('TXT 一行一段，标题用文件名；GBK 的也读得出来', () => {
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  const result = run([file('随手记.txt', '    第一行\n第二行\n\n\n第三行\n'), { name: '问候.TXT', data: gbk }]);
  assert.equal(body(result.imported[0]!.id), '# 随手记\n\n第一行\n\n第二行\n\n第三行');
  assert.equal(body(result.imported[1]!.id), '# 问候\n\n你好');
});

test('开头的属性块：创建和修改时间照它的，title 在没有标题行时当标题，别的属性留成一段代码', () => {
  const text = ['---', 'title: 读书会', 'created: 2026-10-01T02:00:00.000Z', 'updated: "2026-10-03T04:00:00.000Z"',
    'tags:', '  - 读书', '---', '', '正文第一段'].join('\n');
  const [note] = run([file('book-club.md', text)]).imported;
  assert.equal(note?.title, '读书会');
  assert.equal(note?.createdAt, '2026-10-01T02:00:00.000Z');
  assert.equal(note?.updatedAt, '2026-10-03T04:00:00.000Z');
  assert.equal(body(note!.id), '# 读书会\n\n```yaml\ntags:\n  - 读书\n```\n\n正文第一段');
});

test('时间写得不对或在将来就不认，按现在算；开头两道线之间不是属性的不当属性块', () => {
  const future = ['---', 'created: 2031-01-01T00:00:00.000Z', 'updated: 不是时间', '---', '# 标题', '正文'].join('\n');
  const rule = '---\n\n一段话\n\n---\n\n另一段';
  const result = run([file('a.md', future), file('分隔线.md', rule)]);
  assert.equal(result.imported[0]?.createdAt, result.imported[0]?.updatedAt);
  assert.notEqual(result.imported[0]?.createdAt, '2031-01-01T00:00:00.000Z');
  assert.equal(body(result.imported[0]!.id), '# 标题\n正文');
  assert.equal(body(result.imported[1]!.id), `# 分隔线\n\n${rule}`);
});

test('没导入的写明原因：不是 md / txt、空文件、不是文字、太长；别的照常导入', () => {
  const result = run([
    file('表格.xlsx', 'x'), file('空的.md', ' \n\n'), { name: '图片.md', data: Buffer.from([0x89, 0x50, 0x00, 0x01]) },
    file('太长.txt', '字'.repeat(NOTE_MAX_CHARS + 1)), file('好的.md', '# 好的'),
  ]);
  assert.deepEqual(result.skipped, [
    { name: '表格.xlsx', reason: '不是 .md 或 .txt 文件' },
    { name: '空的.md', reason: '文件是空的' },
    { name: '图片.md', reason: '不是文字文件' },
    { name: '太长.txt', reason: '超过 40 万字，一篇笔记放不下' },
  ]);
  assert.deepEqual(result.imported.map((note) => note.title), ['好的']);
  assert.equal(t.state.notes.list({}, { limit: 10 }).length, 1);
});

test('导出时改成相对路径的图：这台 Plasticine 里还有的接回去，没有的照原样留着', () => {
  const asset = t.state.notes.writeAsset(PNG, 'image/png');
  const text = `# 带图\n\n![有的](assets/${asset.name})\n\n![没有的](assets/missing.png)\n\n![本地](../图片/截图.png)`;
  const [note] = run([file('带图.md', text)]).imported;
  assert.equal(body(note!.id), `# 带图\n\n![有的](/v2/notes/assets/${asset.name})\n\n![没有的](assets/missing.png)`
    + '\n\n![本地](../图片/截图.png)');
});
