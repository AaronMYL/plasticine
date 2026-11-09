import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardsToTab, restackIndex, tabLayer, viewBounds, type TabLayer } from '../src/tabs/tab-layering.ts';

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

/**
 * Electron 的 View.addChildView(view, index) 对已经在里面的子视图是「先摘下再插到 index」（45.2.3 实测：
 * [tab, ui] 上 addChildView(tab, 1) 得到 [ui, tab]），index 超出时插到末尾。照这个规则模拟。
 */
function addChildView(children: string[], view: string, index?: number): string[] {
  const rest = children.filter((child) => child !== view);
  const at = Math.min(rest.length, index ?? rest.length);
  return [...rest.slice(0, at), view, ...rest.slice(at)];
}

function relayout(children: string[], layer: TabLayer): string[] {
  const index = restackIndex(children, 'ui', 'tab', layer);
  return index === null ? children : addChildView(children, 'tab', index);
}

test('垫在下面时同步多少次都还在界面下面（以前每同步一次就在界面上下翻一次，网页和圆球来回闪）', () => {
  let children = ['tab', 'ui'];
  for (let round = 0; round < 6; round += 1) {
    children = relayout(children, 'below');
    assert.deepEqual(children, ['tab', 'ui']);
  }
});

test('叠在上面和垫到下面来回换：每次都落在对的那一层，已经在对的那层就不挪', () => {
  let children = ['other', 'tab', 'ui'];
  children = relayout(children, 'above');
  assert.deepEqual(children, ['other', 'ui', 'tab']);
  assert.equal(restackIndex(children, 'ui', 'tab', 'above'), null);
  children = relayout(children, 'below');
  assert.deepEqual(children, ['other', 'tab', 'ui']);
  assert.equal(restackIndex(children, 'ui', 'tab', 'below'), null);
  children = relayout(children, 'above');
  assert.deepEqual(children, ['other', 'ui', 'tab']);
});

test('还没加进窗口的视图：要在下面就插在界面前面，要在上面就放到最后', () => {
  assert.deepEqual(relayout(['ui'], 'below'), ['tab', 'ui']);
  assert.deepEqual(relayout(['ui'], 'above'), ['ui', 'tab']);
});
