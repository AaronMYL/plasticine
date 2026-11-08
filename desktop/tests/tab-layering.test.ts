import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardsToTab, tabLayer, viewBounds } from '../src/tabs/tab-layering.ts';

const FRAME = { x: 324, y: 56, width: 1116, height: 844 };

test('旧界面不报浮层、没有浮层压着时网页标签在上面', () => {
  assert.equal(tabLayer(FRAME, undefined), 'above');
  assert.equal(tabLayer(FRAME, []), 'above');
  assert.equal(tabLayer(FRAME, [{ x: 0, y: 0, width: 300, height: 40 }]), 'above');
  assert.equal(tabLayer(null, [{ x: 400, y: 400, width: 10, height: 10 }]), 'above');
});

test('对话框压在网页标签上：标签垫到下面，浮层外的点转给标签，浮层里的点留给界面', () => {
  const dialog = { x: 900, y: 500, width: 400, height: 360 };
  assert.equal(tabLayer(FRAME, [dialog]), 'below');
  assert.equal(forwardsToTab(500, 300, FRAME, [dialog]), true);
  assert.equal(forwardsToTab(1000, 600, FRAME, [dialog]), false);
  assert.equal(forwardsToTab(100, 300, FRAME, [dialog]), false);
  assert.equal(forwardsToTab(500, 300, FRAME, []), false);
});

test('视图边界取整，宽高不为负', () => {
  assert.deepEqual(viewBounds({ x: 10.4, y: 20.6, width: 100.2, height: -3 }), { x: 10, y: 21, width: 101, height: 0 });
});
