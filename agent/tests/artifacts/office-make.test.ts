import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { officeText, xlsxSheets } from '../../src/cloud-tools/index.ts';
import { blocksHtml } from '../../src/artifacts/office/blocks-html.ts';
import { blocksMarkdown, type ConvertPorts, readSource, tableBlocks, writeAs }
  from '../../src/artifacts/office/convert.ts';
import { cellValue, parseCsv, writeCsv } from '../../src/artifacts/office/csv.ts';
import { makeDocx } from '../../src/artifacts/office/docx-make.ts';
import { markdownBlocks } from '../../src/artifacts/office/markdown-blocks.ts';
import { imageInfo, pixelSize, xmlEscape } from '../../src/artifacts/office/package-xml.ts';
import { makePptx } from '../../src/artifacts/office/pptx-make.ts';
import { makeXlsx, sheetNames } from '../../src/artifacts/office/xlsx-make.ts';

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 3 + 1)] = 0;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))]);
}

const MARKDOWN = [
  '# 周报 <第 3 周> & 小结',
  '',
  '这周**投了 12 份**，*面了 2 场*，`简历.md` 改了一版，[官网](https://example.com) 也更新了。',
  '',
  '## 要点',
  '',
  '- 第一条',
  '- 第二条',
  '',
  '1. 先做这个',
  '2. 再做那个',
  '',
  '> 引用一句话',
  '',
  '```',
  'const total = 12;',
  '```',
  '',
  '| 公司 | 状态 |',
  '|---|---|',
  '| 示例科技 | 面试 |',
  '| 样例网络 | 已投 |',
  '',
  '![截图](图/a.png)',
  '',
  '---',
  '',
  '结尾。',
].join('\n');

test('Markdown parses headings, paragraphs, lists, quotes, code, tables, images, hr, inline styles', () => {
  const blocks = markdownBlocks(MARKDOWN);
  assert.deepEqual(blocks.map((block) => block.kind), ['heading', 'paragraph', 'heading', 'list', 'list', 'quote',
    'code', 'table', 'image', 'rule', 'paragraph']);
  const paragraph = blocks[1];
  assert.ok(paragraph?.kind === 'paragraph');
  assert.deepEqual(paragraph.inline.filter((part) => part.bold || part.italic || part.code || part.link)
    .map((part) => part.text), ['投了 12 份', '面了 2 场', '简历.md', '官网']);
  assert.equal(blocksMarkdown(markdownBlocks('| a | b |\n|---|---|\n| 1 | 2 |')),
    '| a | b |\n| --- | --- |\n| 1 | 2 |');
});

test('generated .docx round-trips all text, embeds images by path, writes placeholder if missing', () => {
  const image = png(40, 20);
  const docx = makeDocx(markdownBlocks(MARKDOWN), (src) => (src === '图/a.png' ? imageInfo(image) : null));
  const text = officeText('docx', docx) ?? '';
  for (const piece of ['周报 <第 3 周> & 小结', '投了 12 份', '第二条', '再做那个', '引用一句话', 'const total = 12;',
    '示例科技', '已投', '结尾。']) {
    assert.ok(text.includes(piece), piece);
  }
  assert.ok(docx.includes(Buffer.from('word/media/image1.png')));
  const missing = officeText('docx', makeDocx(markdownBlocks('![没有的图](x.png)'), () => null)) ?? '';
  assert.ok(missing.includes('［图：没有的图］'));
});

test('generated .xlsx preserves numbers/formulas/bools, sanitizes/dedupes sheet names and layout', () => {
  const xlsx = makeXlsx([
    { name: '销售/汇总', rows: [['月份', '金额', '备注'], ['一月', 1200.5, null], ['二月', 980, true],
      ['合计', '=SUM(B2:B3)', '<含&符号>']] },
    { name: '销售/汇总', rows: [['只有一格']] },
  ]);
  const sheets = xlsxSheets(xlsx);
  assert.deepEqual(sheets?.map((sheet) => sheet.name), ['销售 汇总', '销售 汇总 2']);
  assert.deepEqual(sheets?.[0]?.rows, [['月份', '金额', '备注'], ['一月', '1200.5'], ['二月', '980', '1'],
    ['合计', '', '<含&符号>']]);
  assert.ok(xlsx.includes(Buffer.from('xl/worksheets/sheet2.xml')));
  assert.equal(sheetNames([{ name: '', rows: [] }])[0], '表1');
});

test('generated .pptx round-trips slide titles/bullets, places PNG right, skips non-images', () => {
  const pptx = makePptx([{ title: '第一页', bullets: ['要点一', '要点 <二>'] },
    { title: '带图', bullets: ['左边'], image: png(30, 30) }, { title: '坏图', image: Buffer.from('不是图') }]);
  const text = officeText('pptx', pptx) ?? '';
  assert.match(text, /## 第 1 页\n第一页\n要点一\n要点 <二>/);
  assert.match(text, /## 第 3 页\n坏图/);
  assert.ok(pptx.includes(Buffer.from('ppt/media/image2.png')));
  assert.ok(!pptx.includes(Buffer.from('ppt/media/image3')));
});

test('CSV read/write follows RFC 4180 quotes/newlines with UTF-8 BOM and numeric detection', () => {
  const rows = [['名字', '备注'], ['示例甲', '说 "你好", 再见'], ['样例乙', '两行\n第二行']];
  const text = writeCsv(rows, ',');
  assert.ok(text.startsWith('﻿'));
  assert.deepEqual(parseCsv(text, ','), rows);
  assert.deepEqual(parseCsv('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.equal(cellValue('12.5'), 12.5);
  assert.equal(cellValue('0012'), '0012');
  assert.equal(cellValue('13800000000000000'), '13800000000000000');
});

const PORTS: ConvertPorts = {
  printPdf: async (html) => Buffer.from(`%PDF-1.4 ${html.length}`),
  officeText,
  xlsxSheets,
  pdfText: async () => '第一段\n第二段',
  convertMedia: async (input, output) => Buffer.from(`${input.extension}->${output}`),
};
const OPTIONS = { title: '测试', image: () => null };
const SIGNAL = new AbortController().signal;

test('converts CSV<->Excel, Excel/Word->Markdown, delegates image and audio to ffmpeg', async () => {
  const csv = Buffer.from(writeCsv([['名字', '数量'], ['示例甲', 3]], ','));
  const xlsx = await writeAs(await readSource('名单.csv', 'csv', csv, PORTS, SIGNAL), 'xlsx', PORTS, OPTIONS, SIGNAL);
  const back = await writeAs(await readSource('名单.xlsx', 'xlsx', xlsx, PORTS, SIGNAL), 'csv', PORTS, OPTIONS, SIGNAL);
  assert.equal(back.toString('utf8'), csv.toString('utf8'));
  const md = await writeAs(await readSource('名单.xlsx', 'xlsx', xlsx, PORTS, SIGNAL), 'md', PORTS, OPTIONS, SIGNAL);
  assert.equal(md.toString('utf8'), '| 名字 | 数量 |\n| --- | --- |\n| 示例甲 | 3 |');
  const docx = makeDocx(markdownBlocks('# 标题\n\n正文一段'), () => null);
  const text = await writeAs(await readSource('a.docx', 'docx', docx, PORTS, SIGNAL), 'txt', PORTS, OPTIONS, SIGNAL);
  assert.equal(text.toString('utf8'), '标题\n\n正文一段');
  const image = await writeAs(await readSource('a.png', 'png', png(2, 2), PORTS, SIGNAL), 'webp', PORTS, OPTIONS,
    SIGNAL);
  assert.equal(image.toString(), 'png->webp');
  const audio = await writeAs(await readSource('a.mp4', 'mp4', Buffer.from('x'), PORTS, SIGNAL), 'mp3', PORTS,
    OPTIONS, SIGNAL);
  assert.equal(audio.toString(), 'mp4->mp3');
  await assert.rejects(writeAs(await readSource('a.wav', 'wav', Buffer.from('x'), PORTS, SIGNAL), 'mp4', PORTS,
    OPTIONS, SIGNAL), /转不成/);
  await assert.rejects(readSource('a.exe', 'exe', Buffer.from('x'), PORTS, SIGNAL), /转不了/);
});

test('PDF print renders doc/table to single-page HTML with escaped text and http(s) links only', async () => {
  const html = blocksHtml(markdownBlocks('# <b>标题</b>\n\n[坏链接](javascript:alert(1)) [好链接](https://example.com)'),
    '标题', () => null);
  assert.ok(html.includes('&lt;b&gt;标题&lt;/b&gt;'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('<a href="https://example.com">好链接</a>'));
  const blocks = tableBlocks([{ name: '表1', rows: [['a', 'b'], [1, '*不是斜体*']] }]);
  const table = blocks[0];
  assert.ok(table?.kind === 'table');
  assert.deepEqual(table.rows[0]?.[1], [{ text: '*不是斜体*' }]);
  const pdf = await writeAs({ kind: 'table', sheets: [{ name: '表1', rows: [['a']] }] }, 'pdf', PORTS, OPTIONS, SIGNAL);
  assert.ok(pdf.toString().startsWith('%PDF'));
});

test('reads PNG/WebP pixel dimensions and strips XML-disallowed control characters', () => {
  assert.deepEqual(pixelSize(png(12, 7)), { width: 12, height: 7 });
  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'latin1');
  webp.write('WEBPVP8X', 8, 'latin1');
  webp.writeUIntLE(319, 24, 3);
  webp.writeUIntLE(159, 27, 3);
  assert.deepEqual(pixelSize(webp), { width: 320, height: 160 });
  assert.equal(xmlEscape('a\u0001b<c>'), 'ab&lt;c&gt;');
});
