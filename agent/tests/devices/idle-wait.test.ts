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

test('when user is active, notifies user first then clicks once user becomes idle', async () => {
  const { check, notified, slept } = rig([active, active, active, null]);
  const decision = await check();
  assert.equal(decision.allowed, true);
  assert.deepEqual(notified, ['示例 Mac:点开会话']);
  assert.equal(slept(), 3);
});

test('long wait yields user-active back to line and suggests background web approach', async () => {
  const { check } = rig(Array.from({ length: 50 }, () => active), 10_000);
  const decision = await check();
  assert.equal(decision.allowed, false);
  assert.match(decision.allowed ? '' : decision.message, /tab_shot \/ tab_point \/ tab_type/);
});
