import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageInfo, makeDocx, type Block } from '../../src/artifacts/index.ts';
import { docxBlocks } from '../../src/transfer/docx-blocks.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/'
  + 'iZk9HQAAAABJRU5ErkJggg==', 'base64');

test('Round-trips generated Word doc: headings, styles, lists, tables, quotes, images', () => {
  const blocks: Block[] = [
    { kind: 'heading', level: 1, inline: [{ text: '周报' }] },
    { kind: 'paragraph', inline: [{ text: '这周' }, { text: '上线', bold: true }, { text: '了' },
      { text: '两个', italic: true }] },
    { kind: 'heading', level: 2, inline: [{ text: '进展' }] },
    { kind: 'list', ordered: false, items: [[{ text: '一' }], [{ text: '二' }]] },
    { kind: 'list', ordered: true, items: [[{ text: '先' }]] },
    { kind: 'table', head: [[{ text: '项' }], [{ text: '值' }]], rows: [[[{ text: '甲' }], [{ text: '1' }]]] },
    { kind: 'quote', inline: [{ text: '原话' }] },
    { kind: 'code', text: 'a < b\nc' },
    { kind: 'rule' },
    { kind: 'image', src: 'pic', alt: '示意' },
  ];
  const docx = makeDocx(blocks, (src) => (src === 'pic' ? imageInfo(PNG) : null));
  const saved: string[] = [];
  const back = docxBlocks(docx, (data, name) => {
    saved.push(name);
    assert.deepEqual(data, PNG);
    return '/v2/notes/assets/saved.png';
  });
  assert.deepEqual(saved, ['media/image1.png']);
  assert.deepEqual(back, [...blocks.slice(0, 9), { kind: 'image', src: '/v2/notes/assets/saved.png', alt: '示意' }]);
});

test('Rejects non-Word files on read', () => {
  assert.equal(docxBlocks(Buffer.from('不是 zip'), () => null), null);
});
