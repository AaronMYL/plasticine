import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { WebTabIconEventSchema } from '../../agent/shared/api/desktop-bridge.ts';
import { iconDataUrl, iconType } from '../src/tabs/tab-favicon.ts';

test('detects icon MIME from header or extension fallback and rejects non-images', () => {
  assert.equal(iconType('image/png; charset=binary', 'https://a.b/x'), 'image/png');
  assert.equal(iconType('application/octet-stream', 'https://a.b/favicon.ico?v=2'), 'image/x-icon');
  assert.equal(iconType('text/html', 'https://a.b/'), null);
});

test('encodes icon as data URL, rejects empty or >64 KB, and validates event shape against schema', () => {
  const icon = iconDataUrl(new Uint8Array([1, 2, 3]), 'image/png');
  assert.equal(icon, 'data:image/png;base64,AQID');
  assert.equal(iconDataUrl(new Uint8Array(64 * 1024 + 1), 'image/png'), null);
  assert.equal(iconDataUrl(new Uint8Array(0), 'image/png'), null);
  assert.ok(Value.Check(WebTabIconEventSchema, { type: 'icon', tabId: 't-1', pageUrl: 'https://github.com/', icon }));
  assert.ok(!Value.Check(WebTabIconEventSchema, { type: 'icon', tabId: 't-1', pageUrl: '', icon: 'javascript:1' }));
});
