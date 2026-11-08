import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { WebTabIconEventSchema } from '../../agent/shared/api/desktop-bridge.ts';
import { iconDataUrl, iconType } from '../src/tabs/tab-favicon.ts';

test('图标类型认响应头，不可靠时按后缀认，不是图片不收', () => {
  assert.equal(iconType('image/png; charset=binary', 'https://a.b/x'), 'image/png');
  assert.equal(iconType('application/octet-stream', 'https://a.b/favicon.ico?v=2'), 'image/x-icon');
  assert.equal(iconType('text/html', 'https://a.b/'), null);
});

test('图标转成 data 地址，超过 64 KB 或是空的不要；事件形状过共享 schema', () => {
  const icon = iconDataUrl(new Uint8Array([1, 2, 3]), 'image/png');
  assert.equal(icon, 'data:image/png;base64,AQID');
  assert.equal(iconDataUrl(new Uint8Array(64 * 1024 + 1), 'image/png'), null);
  assert.equal(iconDataUrl(new Uint8Array(0), 'image/png'), null);
  assert.ok(Value.Check(WebTabIconEventSchema, { type: 'icon', tabId: 't-1', pageUrl: 'https://github.com/', icon }));
  assert.ok(!Value.Check(WebTabIconEventSchema, { type: 'icon', tabId: 't-1', pageUrl: '', icon: 'javascript:1' }));
});
