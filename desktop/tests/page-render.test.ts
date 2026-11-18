import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderRequestAllowed, shotSize } from '../src/app/page-render-rules.ts';

test('出 PDF、长图的窗口只能拿页面自己和它带着的东西，别的网址一律不去', () => {
  const page = new Set(['file:///tmp/plasticine-render-1.html']);
  assert.equal(renderRequestAllowed('file:///tmp/plasticine-render-1.html#top', page), true);
  assert.equal(renderRequestAllowed('data:image/png;base64,AAAA', page), true);
  assert.equal(renderRequestAllowed('blob:null/1', page), true);
  assert.equal(renderRequestAllowed('https://example.test/a.png', page), false);
  assert.equal(renderRequestAllowed('file:///etc/passwd', page), false);
});

test('长图：不太长的两倍清晰，太长的一倍，再长截到上限', () => {
  assert.deepEqual(shotSize(3000), { height: 3000, scale: 2 });
  assert.deepEqual(shotSize(12_000), { height: 12_000, scale: 1 });
  assert.deepEqual(shotSize(50_000), { height: 16_000, scale: 1 });
});
