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

test('切到网页：先垫在界面下面显示（界面换好之前被旧画面盖着），要叠在上面的过一会儿再升上去', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  assert.deepEqual(views.moves, ['a:below', 'a:show']);
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(views.layer.get('a'), 'above');
});

test('有圆球压着（垫在下面）：显示之后每次同步都不再挪它', (t) => {
  const { stage: tabs, views } = stage(t);
  for (let round = 0; round < 5; round += 1) {
    tabs.update('a', 'below');
  }
  t.mock.timers.tick(SETTLE_MS);
  assert.deepEqual(views.moves, ['a:below', 'a:show']);
});

test('等着升上去的时候界面又报了几次（换页淡入时位置每帧在变）：不提前升', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  t.mock.timers.tick(SETTLE_MS / 2);
  tabs.update('a', 'above');
  assert.equal(views.layer.get('a'), 'below');
  t.mock.timers.tick(SETTLE_MS);
  assert.equal(views.layer.get('a'), 'above');
});

test('浮层出来要垫到下面：马上下去，等着的升起取消', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  tabs.update('a', 'below');
  t.mock.timers.tick(SETTLE_MS * 2);
  assert.equal(views.layer.get('a'), 'below');
});

test('离开网页：先垫到下面（界面新画面盖住它），过一会儿再藏；中途又回来就不藏', (t) => {
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

test('换一个标签：新的先垫下面显示，旧的立刻藏', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'below');
  views.moves.length = 0;
  tabs.update('b', 'below');
  assert.deepEqual(views.moves, ['a:hide', 'b:below', 'b:show']);
});

test('关掉的标签忘掉：等着的计时不再动它', (t) => {
  const { stage: tabs, views } = stage(t);
  tabs.update('a', 'above');
  tabs.forget('a');
  views.moves.length = 0;
  t.mock.timers.tick(SETTLE_MS * 2);
  assert.deepEqual(views.moves, []);
  tabs.update(null, 'above');
  assert.deepEqual(views.moves, []);
});

test('已经显示着、浮层收起要升上去：也等一会儿；中途浮层又报回来就不升（界面偶尔报一帧空的浮层，网页不盖住对话框）', (t) => {
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
