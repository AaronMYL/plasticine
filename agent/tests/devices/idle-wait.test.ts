// 他正在用电脑时，真鼠标的点击不直接交回「等他停下来」（11-16）：先告诉他一声，在这一步里等他空闲再点；
// 等太久才交回；网页标签里的动作不受影响。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeviceActionGate, type DeviceHold, type IdleWait } from '../../src/devices/index.ts';
import { autoOnlyPermissionGate, defineTool } from '../../src/tools/index.ts';
import { DeviceActionParameters } from '../../src/devices/device-action.ts';

const tool = defineTool({ name: 'device_action', label: '设备动作', description: '', replay: 'once',
  effect: 'external', permission: 'agreement', roles: ['worker'], timeoutMs: 1_000,
  parameters: DeviceActionParameters, execute: () => Promise.resolve('') });
const click = { nodeId: 'node-1', purpose: '点开会话', action: { kind: 'input_click', x: 10, y: 20 } };
const active: DeviceHold = { why: 'user_active', nodeName: '示例 Mac', remedy: null };

function rig(holds: (DeviceHold | null)[], maxMs = 60_000) {
  const notified: string[] = [];
  let slept = 0;
  const devices = {
    perform: () => Promise.reject(new Error('不该执行')),
    screen: () => null,
    recordRefusal: () => undefined,
    hold: () => holds.shift() ?? null,
  };
  const wait: IdleWait = { pollMs: 5_000, maxMs, notify: (_run, node, purpose) => notified.push(`${node}:${purpose}`),
    sleep: () => {
      slept += 1;
      return Promise.resolve(true);
    } };
  const gate = createDeviceActionGate(devices, autoOnlyPermissionGate, undefined, wait);
  const check = () => gate.check({ tool, args: click, runId: 'line:line-1', actionId: 'line:line-1:c1',
    signal: new AbortController().signal });
  return { check, notified, slept: () => slept };
}

test('他在用电脑：先告诉他一声，等他空闲后接着点', async () => {
  const { check, notified, slept } = rig([active, active, active, null]);
  const decision = await check();
  assert.equal(decision.allowed, true);
  assert.deepEqual(notified, ['示例 Mac:点开会话']);
  assert.equal(slept(), 3);
});

test('等太久才把他正在用交回给线，并提示改用网页后台的做法', async () => {
  const { check } = rig(Array.from({ length: 50 }, () => active), 10_000);
  const decision = await check();
  assert.equal(decision.allowed, false);
  assert.match(decision.allowed ? '' : decision.message, /tab_shot \/ tab_point \/ tab_type/);
});
