import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { deviceBackText, resumeAfterDevice } from '../../src/app/device-resume.ts';
import {
  createDeviceActionGate, createDeviceLogsTool, DEFAULT_DEVICE_LIMITS, DeviceService, DeviceWaits,
} from '../../src/devices/index.ts';
import type { StateService } from '../../src/state/index.ts';
import { autoOnlyPermissionGate } from '../../src/tools/index.ts';
import { memoryState, toolContext } from '../tools/helpers.ts';

// 11-16：设备卡住时 AI 能自己查（报到记录、动作、设备自己的日志），设备回来后等它的任务接着做。
let state: StateService;
let devices: DeviceService;
let nodeId: string;
let now: number;

beforeEach(() => {
  state = memoryState();
  now = Date.parse('2026-11-16T10:48:00.000Z');
  devices = new DeviceService({ state, now: () => new Date(now), dryRun: false,
    logsDirectory: mkdtempSync(join(tmpdir(), 'device-logs-')) });
  const at = new Date(now).toISOString();
  const issuer = state.devices.create({ name: '手机', firstSeenAt: at, lastSeenAt: at }).id;
  const { code } = devices.issueCode(issuer);
  const found = devices.findCode(code);
  assert.ok(found !== undefined);
  nodeId = devices.pair(found, { requestId: 'pair-00000001', code, name: 'Mac', platform: 'macos',
    appVersion: '0.1.0', protocolVersion: 1, capabilities: ['file_read', 'tab_shot'] }).node.id;
  devices.setLimits(nodeId, 0, { ...DEFAULT_DEVICE_LIMITS, roots: ['~/Documents'] },
    { deviceId: issuer, confirmedAt: at }, (action) => action());
});

afterEach(() => {
  devices.stop();
  state.close();
});

function hello() {
  const node = state.nodes.require(nodeId);
  return devices.hello(node, { appVersion: '0.1.0', protocolVersion: 1, capabilities: node.capabilities,
    busy: { actionId: 'line:x:shot', kind: 'tab_shot', step: '截标签画面', since: new Date(now).toISOString() } });
}

test('device_logs：要设备的日志，设备下次报到时被要求另起一条请求传上来，工具连同报到记录一起给', async () => {
  hello();
  const tool = createDeviceLogsTool(state, devices);
  const answer = tool.execute({ nodeId, minutes: 30 }, toolContext('logs'));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const asked = hello().logsWanted;
  assert.ok(asked !== null);
  devices.receiveLogs(nodeId, { requestId: asked.requestId, truncated: false,
    lines: [{ at: new Date(now).toISOString(), text: '开始做：tab_shot line:x:shot' }] });
  const result = JSON.parse(await answer) as { node: { work: { state: string; step: string } };
    hellos: { busy: string | null }[]; device: { lines: { text: string }[] } };
  assert.equal(result.node.work.state, 'busy');
  assert.equal(result.node.work.step, '截标签画面');
  assert.match(result.hellos.at(-1)?.busy ?? '', /截标签画面/);
  assert.equal(result.device.lines[0]?.text, '开始做：tab_shot line:x:shot');
  assert.equal(hello().logsWanted, null);
  assert.equal(devices.logs?.latest(nodeId)?.lines.length, 1);
});

test('设备离线时动作没发出：记下这条线在等它，回来后往那条线说一句接着做；做成一个动作就划掉', async () => {
  now += 5 * 60_000;
  const gate = createDeviceActionGate(devices.actions, autoOnlyPermissionGate, undefined, undefined, devices.waits);
  const decision = await gate.check({ tool: { name: 'device_action' } as never, runId: 'line:line-boss',
    actionId: 'line:line-boss:c1', signal: new AbortController().signal,
    args: { nodeId, purpose: '截 BOSS 会话列表', action: { kind: 'tab_shot', tabId: 't-1' } } } as never);
  assert.equal(decision.allowed, false);
  assert.match(decision.allowed ? '' : decision.message ?? '', /接着做/);
  assert.deepEqual(devices.waits.list().map((wait) => wait.lineId), ['line-boss']);
  const sent: { lineId: string; text: string }[] = [];
  resumeAfterDevice({ lines: { get: () => ({ archivedAt: null, pauseReason: null }) } } as never,
    () => ({ send: (lineId: string, input: { text: string }) => {
      sent.push({ lineId, text: input.text });
      return {} as never;
    } }) as never, devices.waits.take(nodeId), 'Mac', new Date(now).toISOString());
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.lineId, 'line-boss');
  assert.match(sent[0]?.text ?? '', /不要另开任务/);
  assert.deepEqual(devices.waits.take(nodeId), []);
  const waits = new DeviceWaits(state, () => new Date(now));
  waits.add('line:line-a', nodeId, '离线');
  waits.done('line:line-a', nodeId);
  assert.deepEqual(waits.list(), []);
});

test('设备回来那句话说清是谁、几点回来、之前卡在哪', () => {
  const text = deviceBackText('Mac', { lineId: 'l', nodeId: 'n', why: '「截图」结果不明', at: '' },
    '2026-11-16T11:30:00.000Z');
  assert.match(text, /「Mac」19:30 回来了/);
  assert.match(text, /「截图」结果不明/);
});
