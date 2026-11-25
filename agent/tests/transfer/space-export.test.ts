import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { EMPTY_SPACE_DOC } from '../../shared/state.ts';
import { docxBlocks } from '../../src/transfer/docx-blocks.ts';
import { exportSpaces, importSpaces } from '../../src/transfer/index.ts';
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

const report = (title: string, html: string) => t.state.spaces.create({ title, doc: EMPTY_SPACE_DOC, genre: 'report',
  html, author: 'ai', category: 'report' });

test('Exports report to Markdown with title/sections/tables; single .md if no images', () => {
  const space = report('季度复盘', '<header class="rp-hero"><h1 class="rp-h1">季度复盘</h1></header>'
    + '<section class="rp-sec"><h2>进展</h2><p>上线了<strong>两个</strong>功能。</p></section>');
  const file = exportSpaces(t.state, [space.id], 'markdown');
  assert.equal(file.name, '季度复盘.md');
  assert.equal(file.data.toString('utf8'), '# 季度复盘\n\n## 进展\n\n上线了**两个**功能。\n');
});

test('Bundles Markdown with images into zip assets/; prepends title for letters', () => {
  const asset = t.state.notes.writeAsset(PNG, 'image/png');
  const letter = t.state.spaces.create({ title: '这一周', doc: EMPTY_SPACE_DOC, genre: 'letter', author: 'ai',
    html: `<p class="lt-lead">这周不错。</p><figure class="lt-fig"><img src="/v2/notes/assets/${asset.name}" alt="窗外">`
      + '</figure>', category: 'letter' });
  const zip = openZip(exportSpaces(t.state, [letter.id], 'markdown').data)!;
  assert.deepEqual(zip.names().sort(), [`assets/${asset.name}`, '这一周.md']);
  assert.equal(zip.read('这一周.md')?.toString('utf8'), `# 这一周\n\n这周不错。\n\n![窗外](assets/${asset.name})\n`);
});

test('Word export preserves blocks on read-back; multiple spaces bundle into one zip', () => {
  const asset = t.state.notes.writeAsset(PNG, 'image/png');
  const first = report('一', `<h1>一</h1><p>正文一</p><img src="/v2/notes/assets/${asset.name}" alt="图">`);
  const second = report('二', '<h1>二</h1><ul><li>甲</li></ul>');
  const one = exportSpaces(t.state, [first.id], 'docx');
  assert.equal(one.name, '一.docx');
  const blocks = docxBlocks(one.data, () => 'saved');
  assert.deepEqual(blocks, [{ kind: 'heading', level: 1, inline: [{ text: '一' }] },
    { kind: 'paragraph', inline: [{ text: '正文一' }] }, { kind: 'image', src: 'saved', alt: '图' }]);
  const both = exportSpaces(t.state, [first.id, second.id], 'docx');
  assert.equal(both.name, 'Plasticine 资料库（2 篇）.zip');
  assert.deepEqual(openZip(both.data)?.names(), ['一.docx', '二.docx']);
});

test('Re-importing exported Markdown restores title and body', () => {
  const space = report('读书会', '<header class="rp-hero"><h1 class="rp-h1">读书会</h1></header>'
    + '<section class="rp-sec" id="s1"><h2>书单</h2><ol><li>第一本</li><li>第二本</li></ol></section>');
  const file = exportSpaces(t.state, [space.id], 'markdown');
  const [back] = importSpaces(t.state, [{ name: file.name, data: file.data }], 'user').imported;
  assert.equal(back?.title, '读书会');
  assert.equal(back?.html, space.html);
});
