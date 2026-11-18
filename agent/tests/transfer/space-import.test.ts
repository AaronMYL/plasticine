import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { imageInfo, makeDocx } from '../../src/artifacts/index.ts';
import { importSpaces } from '../../src/transfer/index.ts';
import { spaceMarkerScript } from '../../shared/space-marker.ts';
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

const file = (name: string, text: string) => ({ name, data: Buffer.from(text, 'utf8') });

test('Markdown 套成基础报告：第一个一级标题是大标题，二级标题分节；归在报告里、作者是用户', () => {
  const md = '# 季度复盘\n\n开头一段话说清楚。\n\n## 进展\n\n- 上线两个功能\n- 修了三处\n\n| 项 | 值 |\n| --- | --- |\n| 新用户 | 12 |';
  const { imported, skipped } = importSpaces(t.state, [file('复盘.md', md)], 'user');
  assert.deepEqual(skipped, []);
  const [space] = imported;
  assert.equal(space?.title, '季度复盘');
  assert.equal(space?.category, 'report');
  assert.equal(space?.genre, 'report');
  assert.equal(space?.author, 'user');
  assert.equal(space?.html, '<header class="rp-hero"><h1 class="rp-h1">季度复盘</h1></header>'
    + '<section class="rp-sec" id="s1"><p>开头一段话说清楚。</p></section><section class="rp-sec" id="s2"><h2>进展</h2>'
    + '<ul><li>上线两个功能</li><li>修了三处</li></ul><table class="rt"><thead><tr><th>项</th><th>值</th></tr></thead>'
    + '<tbody><tr><td>新用户</td><td>12</td></tr></tbody></table></section>');
});

test('TXT 一行一段、标题用文件名；网页取 body，标题用 <title>，data: 图存成资产，外面的图写成一行字', () => {
  const page = '<html><head><title>出行 &amp; 清单</title></head><body><p>带上身份证，提前到。</p>'
    + `<img src="data:image/png;base64,${PNG.toString('base64')}" alt="地图">`
    + '<img src="https://x.test/a.png"></body></html>';
  const { imported } = importSpaces(t.state, [file('随手记.txt', '第一行写点什么\n第二行'), file('page.html', page)],
    'user');
  assert.equal(imported[0]?.title, '随手记');
  assert.match(imported[0]?.html ?? '', /<p>第一行写点什么<\/p><p>第二行<\/p>/);
  assert.equal(imported[1]?.title, '出行 & 清单');
  const asset = /src="\/v2\/notes\/assets\/([^"]+)"/.exec(imported[1]?.html ?? '')?.[1];
  assert.deepEqual(t.state.notes.readAsset(asset ?? '')?.data, PNG);
  assert.match(imported[1]?.html ?? '', /<p class="f3">图片没带进来：https:\/\/x\.test\/a\.png<\/p>/);
});

test('Word：标题、列表、图都进来', () => {
  const docx = makeDocx([{ kind: 'heading', level: 1, inline: [{ text: '会议纪要' }] },
    { kind: 'paragraph', inline: [{ text: '今天定了三件事情。' }] },
    { kind: 'list', ordered: true, items: [[{ text: '先做' }], [{ text: '后做' }]] },
    { kind: 'image', src: 'pic', alt: '白板' }], (src) => (src === 'pic' ? imageInfo(PNG) : null));
  const [space] = importSpaces(t.state, [{ name: '纪要.docx', data: docx }], 'user').imported;
  assert.equal(space?.title, '会议纪要');
  assert.match(space?.html ?? '',
    /<ol><li>先做<\/li><li>后做<\/li><\/ol><figure class="img"><img src="\/v2\/notes\/assets\//);
});

test('Plasticine 导出的网页原样回来，体裁照旧（来信还是来信），归在报告里', () => {
  const html = '<p class="lt-lead">这周过得不错，事情都按计划推进了。</p>';
  const page = `<!doctype html><html><body><div class="rp">别的</div>${spaceMarkerScript({ title: '一封信',
    genre: 'letter', html })}</body></html>`;
  const [space] = importSpaces(t.state, [file('一封信.html', page)], 'user').imported;
  assert.deepEqual([space?.title, space?.genre, space?.category, space?.html], ['一封信', 'letter', 'report', html]);
});

test('没导入的写原因：格式不收、不是 Word、空的、正文太短；别的照常', () => {
  const { imported, skipped } = importSpaces(t.state, [file('a.pdf', 'x'), file('坏的.docx', '不是 zip'),
    file('空的.md', '   '), file('短的.md', '# 短\n\n两字'), file('好的.md', '# 好的\n\n这一篇的正文足够长了。')], 'user');
  assert.deepEqual(skipped, [
    { name: 'a.pdf', reason: '只收 Markdown、TXT、Word（.docx）和网页文件' },
    { name: '坏的.docx', reason: '读不了这个 Word 文件（可能是旧的 .doc 或加了密）' },
    { name: '空的.md', reason: '文件里没有内容' },
    { name: '短的.md', reason: '正文是空的' },
  ]);
  assert.deepEqual(imported.map((space) => space.title), ['好的']);
});
