import assert from 'node:assert/strict';
import { test } from 'node:test';
import { forwardsToTab, HIDDEN_TAB_SIZE, hiddenBounds, restackIndex, tabLayer, viewBounds, type TabLayer }
  from '../src/tabs/tab-layering.ts';

const FRAME = { x: 324, y: 56, width: 1116, height: 844 };

test('keeps web tab on top when legacy UI reports no overlays or no overlay covers tab', () => {
  assert.equal(tabLayer(FRAME, undefined), 'above');
  assert.equal(tabLayer(FRAME, []), 'above');
  assert.equal(tabLayer(FRAME, [{ x: 0, y: 0, width: 300, height: 40 }]), 'above');
  assert.equal(tabLayer(null, [{ x: 400, y: 400, width: 10, height: 10 }]), 'above');
});

test('demotes web tab under chat overlay, forwarding outside clicks to tab and inside clicks to UI', () => {
  const dialog = { x: 900, y: 500, width: 400, height: 360 };
  assert.equal(tabLayer(FRAME, [dialog]), 'below');
  assert.equal(forwardsToTab(500, 300, FRAME, [dialog]), true);
  assert.equal(forwardsToTab(1000, 600, FRAME, [dialog]), false);
  assert.equal(forwardsToTab(100, 300, FRAME, [dialog]), false);
  assert.equal(forwardsToTab(500, 300, FRAME, []), false);
});

test('rounds view bounds to integers with non-negative width and height', () => {
  assert.deepEqual(viewBounds({ x: 10.4, y: 20.6, width: 100.2, height: -3 }), { x: 10, y: 21, width: 101, height: 0 });
});

function addChildView(children: string[], view: string, index?: number): string[] {
  const rest = children.filter((child) => child !== view);
  const at = Math.min(rest.length, index ?? rest.length);
  return [...rest.slice(0, at), view, ...rest.slice(at)];
}

function relayout(children: string[], layer: TabLayer): string[] {
  const index = restackIndex(children, 'ui', 'tab', layer);
  return index === null ? children : addChildView(children, 'tab', index);
}

test('keeps demoted tab below UI across repeated syncs without flickering above/below', () => {
  let children = ['tab', 'ui'];
  for (let round = 0; round < 6; round += 1) {
    children = relayout(children, 'below');
    assert.deepEqual(children, ['tab', 'ui']);
  }
});

test('toggles between promoted and demoted layers cleanly without moving if already in place', () => {
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

test('inserts unmounted view before UI when demoted and at end when promoted', () => {
  assert.deepEqual(relayout(['ui'], 'below'), ['tab', 'ui']);
  assert.deepEqual(relayout(['ui'], 'above'), ['ui', 'tab']);
});

test('sizes hidden tabs to viewport bounds or default so background screenshots are not blank', () => {
  assert.deepEqual(hiddenBounds(FRAME), viewBounds(FRAME));
  assert.deepEqual(hiddenBounds(null), { x: 0, y: 0, ...HIDDEN_TAB_SIZE });
  assert.deepEqual(hiddenBounds({ x: 0, y: 0, width: 0, height: 0 }), { x: 0, y: 0, ...HIDDEN_TAB_SIZE });
});
