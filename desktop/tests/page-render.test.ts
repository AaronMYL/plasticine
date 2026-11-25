import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderRequestAllowed, shotSize } from '../src/app/page-render-rules.ts';

test('PDF and long-image window loads only its own page and assets, blocking external URLs', () => {
  const page = new Set(['file:///tmp/plasticine-render-1.html']);
  assert.equal(renderRequestAllowed('file:///tmp/plasticine-render-1.html#top', page), true);
  assert.equal(renderRequestAllowed('data:image/png;base64,AAAA', page), true);
  assert.equal(renderRequestAllowed('blob:null/1', page), true);
  assert.equal(renderRequestAllowed('https://example.test/a.png', page), false);
  assert.equal(renderRequestAllowed('file:///etc/passwd', page), false);
});

test('long image captures at 2x when short, 1x when tall, and clamps at max height', () => {
  assert.deepEqual(shotSize(3000), { height: 3000, scale: 2 });
  assert.deepEqual(shotSize(12_000), { height: 12_000, scale: 1 });
  assert.deepEqual(shotSize(50_000), { height: 16_000, scale: 1 });
});
