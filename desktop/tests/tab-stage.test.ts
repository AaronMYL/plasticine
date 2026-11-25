import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { TabLayer } from '../src/tabs/tab-layering.ts';
import { SETTLE_MS, TabStage } from '../src/tabs/tab-stage.ts';

interface Recorded {
  layer: Map<string, TabLayer>;
  visible: Map<string, boolean>;
  moves: string[];
}

function stage(t: TestContext): { stage: TabStage; views: Recorded } {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const views: Recorded = { layer: new Map(), visible: new Map(), moves: [] };
  const value = new TabStage({
    place: (tabId, layer) => {
      if (views.layer.get(tabId) !== layer) {
        views.moves.push(`${tabId}:${layer}`);
      }
      views.layer.set(tabId, layer);
    },
    show: (tabId, visible) => {
      views.visible.set(tabId, visible);
      views.moves.push(`${tabId}:${visible ? 'show' : 'hide'}`);
    },
  });
  return { stage: value, views };
}

test('switching to web shows tab demoted first then promotes after brief delay', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  assert.deepEqual(views.moves, ['a:below', 'a:show']);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(views.layer.get('a'), 'above');
});

test('keeps tab demoted under orb without moving it on subsequent syncs', (t) => {
  const { stage: tabs, views } = stage(t);
  for (let round = 0; round < 5; round += 1) {
    tabs.update('a', 'below');
  }
  t.mock.timers.tick(SETTLE_MS);
  assert.deepEqual(views.moves, ['a:below', 'a:show']);
});

test('does not promote early when UI keeps updating bounds during fade-in', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  t.mock.timers.tick(SETTLE_MS / 2);
  tabs.update('a', 'above');
  assert.equal(views.layer.get('a'), 'below');
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(views.layer.get('a'), 'above');
});

test('demotes immediately when overlay appears and cancels pending promote timer', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  tabs.update('a', 'below');
  t.mock.timers.tick(SETTLE_MS * 2);
  assert.equal(views.layer.get('a'), 'below');
});

test('leaving web demotes tab first then hides after delay, canceling hide if returning', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  t.mock.timers.tick(SETTLE_MS);
  tabs.update(null, 'above');
  assert.equal(views.layer.get('a'), 'below');
  assert.equal(views.visible.get('a'), true);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(views.visible.get('a'), false);
  tabs.update('a', 'below');
  tabs.update(null, 'below');
  t.mock.timers.tick(SETTLE_MS / 2);
  tabs.update('a', 'below');
  t.mock.timers.tick(SETTLE_MS * 2);
  assert.equal(views.visible.get('a'), true);
});

test('switching to another tab shows new tab demoted and hides old tab immediately', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'below');
  views.moves.length = 0;
  tabs.update('b', 'below');
  assert.deepEqual(views.moves, ['a:hide', 'b:below', 'b:show']);
});

test('forgets closed tab so pending timers no longer touch it', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  tabs.forget('a');
  views.moves.length = 0;
  t.mock.timers.tick(SETTLE_MS * 2);
  assert.deepEqual(views.moves, []);
  tabs.update(null, 'above');
  assert.deepEqual(views.moves, []);
});

test('delays promote after overlay hides and cancels if overlay reappears next frame', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'below');
  tabs.update('a', 'above');
  assert.equal(views.layer.get('a'), 'below');
  t.mock.timers.tick(SETTLE_MS / 2);
  tabs.update('a', 'below');
  t.mock.timers.tick(SETTLE_MS * 2);
  assert.equal(views.layer.get('a'), 'below');
  tabs.update('a', 'above');
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(views.layer.get('a'), 'above');
  tabs.update('a', 'above');
  assert.deepEqual(views.moves, ['a:below', 'a:show', 'a:above']);
});
