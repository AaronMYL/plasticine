// 读 X 时间线的注入脚本：生成的 Swift 和 client/src/mac/x-timeline-page.ts 对得上；去掉类型后是一段能跑的 JS，
// 装上以后 window.__plasticineXTimeline 有原生层要调的七个方法。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, timelineScript } from './generate-x-timeline-script.ts';

test('生成的 Swift 是最新的', () => {
  assert.doesNotThrow(() => generate(true));
});

test('脚本去掉了类型和 import，装上后给原生层八个方法（第13批多一个切「为你推荐」）', () => {
  const script = timelineScript();
  assert.ok(!/^import /m.test(script));
  assert.ok(!/: XPost\b/.test(script));
  const window = { location: { href: 'https://x.com/home' }, innerHeight: 800, scrollBy: () => undefined,
    document: { querySelector: () => null, querySelectorAll: () => [] } } as unknown as Record<string, unknown>;
  new Function('window', 'HTMLImageElement', 'HTMLBRElement', script)(window, class {}, class {});
  const reader = window['__plasticineXTimeline'] as Record<string, () => unknown>;
  assert.deepEqual(Object.keys(reader).sort(),
    ['collect', 'following', 'fullText', 'posts', 'recommend', 'scroll', 'state', 'truncated']);
  assert.equal(reader['state']?.(), 'loading');
  assert.deepEqual(reader['posts']?.(), []);
  assert.deepEqual(reader['truncated']?.(), []);
});
