// 跨源内嵌框（11-16）：主页面读不进去的框在框自己的 preload 里读，编号接在主页面后面；按编号找回是哪个框、框里第几号。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TabFrames, type FrameHost } from '../src/tabs/tab-frames.ts';
import type { FrameRef } from '../src/tabs/tab-views.ts';

function page(version: string, names: string[], base: number, frameCount = 0): Record<string, unknown> {
  return { version, url: 'https://example.com/', title: '示例', outline: names.map((name, index) =>
    `[${base + index + 1} 按钮「${name}」]`).join('\n'), totalChars: 10, frameCount, truncated: false,
  elements: names.map((name, index) => ({ n: base + index + 1, role: 'button', name })), imageHeavy: false,
  digest: `d-${version}` };
}

const COMMENTS: FrameRef = { processId: 7, routingId: 3, url: 'https://comments.example.net/embed' };
const PIXEL: FrameRef = { processId: 8, routingId: 4, url: 'https://ads.example.org/pixel' };
const BROKEN: FrameRef = { processId: 9, routingId: 5, url: 'https://broken.example.org/' };

function host(calls: string[]): FrameHost {
  return {
    async call() {
      return page('main1', ['登录', '搜索'], 0, 3);
    },
    async callFrame(_tab, frame, op, args) {
      calls.push(`${frame.routingId}:${op}`);
      if (frame === BROKEN) throw new Error('没回话');
      if (op === 'viewport') return frame === PIXEL ? { width: 1, height: 1 } : { width: 600, height: 300 };
      const base = Number((args.request as { base?: number }).base);
      return page('frame1', ['发表评论', '点赞'], base);
    },
    crossFrames: () => [PIXEL, COMMENTS, BROKEN],
  };
}

test('跨源框读进来接在后面：太小的不读，读不出的算进 frameCount；大纲里写是哪个网站的框', async () => {
  const calls: string[] = [];
  const frames = new TabFrames(host(calls));
  const merged = await frames.perceive('t1');
  assert.ok(merged !== null);
  assert.deepEqual((merged.elements as { n: number; name: string }[]).map((item) => [item.n, item.name]),
    [[1, '登录'], [2, '搜索'], [3, '发表评论'], [4, '点赞']]);
  assert.match(String(merged.outline), /〔内嵌框：comments\.example\.net〕\n\[3 按钮「发表评论」\]/);
  assert.equal(merged.frameCount, 1);
  assert.notEqual(merged.version, 'main1');
  assert.ok(!calls.includes('4:operate'), '1×1 的框不读');
  const again = await frames.perceive('t1');
  assert.equal(again?.version, merged.version, '没变就还是同一版');
});

test('按编号找回：主页面的照旧，框里的换成框里的编号和那个框的版本；不在任何一段里的是过期', async () => {
  const frames = new TabFrames(host([]));
  const merged = await frames.perceive('t1');
  const version = String(merged?.version);
  assert.deepEqual(frames.route('t1', version, 2), { frame: null, version: 'main1', n: 2, base: 0 });
  assert.deepEqual(frames.route('t1', version, 4), { frame: COMMENTS, version: 'frame1', n: 2, base: 2 });
  assert.equal(frames.route('t1', version, 9), null);
  assert.deepEqual(frames.route('t1', version, undefined), { frame: null, version: 'main1', n: undefined, base: 0 });
  assert.deepEqual(frames.route('t1', 'plain', 5), { frame: null, version: 'plain', n: 5, base: 0 },
    '没有跨源框的那一版原样给主页面');
});

test('主页面没有读不进去的框：原样回主页面那一版，不碰别的框', async () => {
  const calls: string[] = [];
  const frames = new TabFrames({ ...host(calls), call: async () => page('solo', ['只有我'], 0, 0) });
  const merged = await frames.perceive('t1');
  assert.equal(merged?.version, 'solo');
  assert.deepEqual(calls, []);
});
