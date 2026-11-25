import assert from 'node:assert/strict';
import { test } from 'node:test';
import { macTrafficLights } from '../src/app/traffic-lights.ts';

test('centers traffic lights in 44px bar at x=20 with 62px width on macOS 26+ and 14px gap to back', () => {
  assert.deepEqual(macTrafficLights('26.1.0'), { position: { x: 20, y: 15 }, inset: 96 });
  assert.deepEqual(macTrafficLights('16.0'), { position: { x: 20, y: 15 }, inset: 96 });
});

test('uses 54px total traffic-light width on macOS 15 and earlier', () => {
  assert.deepEqual(macTrafficLights('15.6.1'), { position: { x: 20, y: 15 }, inset: 88 });
  assert.deepEqual(macTrafficLights('14.0'), { position: { x: 20, y: 15 }, inset: 88 });
  assert.equal(macTrafficLights('').inset, 88);
});
