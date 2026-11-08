import assert from 'node:assert/strict';
import { test } from 'node:test';
import { macTrafficLights } from '../src/app/traffic-lights.ts';

test('红绿灯在 44 高的标题栏里竖直居中、离左边 20；macOS 26 起三个灯总宽 62，← 离最后一个灯 14', () => {
  assert.deepEqual(macTrafficLights('26.1.0'), { position: { x: 20, y: 15 }, inset: 96 });
  // 用旧 SDK 编的程序在 macOS 26 上读到兼容号 16.x。
  assert.deepEqual(macTrafficLights('16.0'), { position: { x: 20, y: 15 }, inset: 96 });
});

test('macOS 15 及以前：三个灯总宽 54', () => {
  assert.deepEqual(macTrafficLights('15.6.1'), { position: { x: 20, y: 15 }, inset: 88 });
  assert.deepEqual(macTrafficLights('14.0'), { position: { x: 20, y: 15 }, inset: 88 });
  assert.equal(macTrafficLights('').inset, 88);
});
