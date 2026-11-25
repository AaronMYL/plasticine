import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { NodeActionEnvelope } from '../../shared/api/index.ts';
import { autoOnlyPermissionGate, type PermissionGate } from '../../src/tools/index.ts';
import {
  createDeviceActionGate, createDeviceActionTool, createDeviceNodesTool, DEFAULT_DEVICE_LIMITS, DeviceService,
} from '../../src/devices/index.ts';
import { adaptLegacyTool } from '../../src/lines/index.ts';
import type { StateService } from '../../src/state/index.ts';
import { FIXED_NOW, memoryState, toolContext } from '../tools/helpers.ts';

let state: StateService;
let sent: NodeActionEnvelope[];
let devices: DeviceService;
let nodeId: string;

const allowAll: PermissionGate = { check: () => Promise.resolve({ allowed: true }) };

beforeEach(() => {
  state = memoryState();
  sent = [];
  devices = new DeviceService({
    state,
    now: () => FIXED_NOW,
    dryRun: false,
    transport: {
      send(envelope) {
        sent.push(envelope);
        const executedAt = FIXED_NOW.toISOString();
        return Promise.resolve({ actionId: envelope.actionId, status: 'executed', executedAt });
      },
    },
  });
  const at = FIXED_NOW.toISOString();
  const issuer = state.devices.create({ name: '手机', firstSeenAt: at, lastSeenAt: at }).id;
  const { code } = devices.issueCode(issuer);
  const found = devices.findCode(code);
  assert.ok(found !== undefined);
  const request = {
    requestId: 'pair-00000001',
    code,
    name: 'Mac',
    platform: 'macos' as const,
    appVersion: '0.1.0',
    protocolVersion: 1,
    capabilities: ['file_read' as const],
  };
  nodeId = devices.pair(found, request).node.id;
  const limits = {
    ...DEFAULT_DEVICE_LIMITS,
    roots: ['~/Documents'],
    classes: { ...DEFAULT_DEVICE_LIMITS.classes, read: { mode: 'allow' as const, perHour: 1 } },
  };
  devices.setLimits(nodeId, 0, limits, { deviceId: issuer, confirmedAt: at }, (action) => action());
});

afterEach(() => {
  devices.stop();
  state.close();
});

test('brain inspects paired nodes, online status, capabilities, and limits without credential hash', async () => {
  const answer = await createDeviceNodesTool(devices).execute({}, toolContext('nodes'));
  const [node] = JSON.parse(answer) as Record<string, unknown>[];
  assert.equal(node?.['id'], nodeId);
  assert.equal(node?.['online'], true);
  assert.deepEqual(node?.['capabilities'], ['file_read']);
  assert.ok(node?.['limits']);
  assert.ok(!answer.includes('credential'));
});

type Outcome = { outcome: 'ok' | 'error'; content: string };

function dispatcher(fallback: PermissionGate): (path: string, callId: string) => Promise<Outcome> {
  const permission = createDeviceActionGate(devices.actions, fallback);
  const tool = adaptLegacyTool(createDeviceActionTool(devices.actions), { say: () => '设备动作' },
    { dryRun: false, now: () => FIXED_NOW, permission }).create({ lineId: 'line-main', kind: 'main', projectId: null });
  return async (path, callId) => {
    const params = { nodeId, purpose: '读这份笔记核对内容', action: { kind: 'file_read', path } };
    try {
      const result = await tool.execute(callId, params, new AbortController().signal);
      const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      return { outcome: 'ok', content: text };
    } catch (error) {
      return { outcome: 'error', content: (error as Error).message };
    }
  };
}

test('over-limit brain device action is rejected immediately, returned to brain, logged, not sent', async () => {
  const run = dispatcher(allowAll);
  const first = await run('~/Documents/a.md', 'c1');
  assert.equal(first.outcome, 'ok');
  const second = await run('~/Documents/b.md', 'c2');
  assert.equal(second.outcome, 'error');
  assert.match(second?.content ?? '', /这一小时已经做了 1 次，到了上限 1 次/);
  assert.equal(sent.length, 1);
  const rows = state.nodeActions.recent(nodeId);
  assert.equal(rows.filter((row) => row.status === 'refused' && row.refusalLayer === 'count').length, 1);
});

test('within-limit action on online node runs directly without agreement gate or protected paths', async () => {
  const dotfile = await dispatcher(autoOnlyPermissionGate)('~/Documents/.env', 'c1');
  assert.equal(dotfile.outcome, 'ok');
  assert.equal(sent.length, 1);
});

test('offline node action does not run directly and reports node offline clearly', async () => {
  const node = state.nodes.require(nodeId);
  state.nodes.update(node.id, node.version, { lastSeenAt: new Date(FIXED_NOW.getTime() - 90_001).toISOString() });
  const result = await dispatcher(autoOnlyPermissionGate)('~/Documents/a.md', 'c1');
  assert.match(result.content, /离线/);
  assert.equal(sent.length, 0);
});

test('replaying same call reuses prior result even when hourly quota is exhausted', async () => {
  const run = dispatcher(allowAll);
  const first = await run('~/Documents/a.md', 'c1');
  const again = await run('~/Documents/a.md', 'c1');
  assert.equal(first.outcome, 'ok');
  assert.equal(again.outcome, 'ok');
  assert.equal(sent.length, 1);
});

test('device tool failure preserves real exception and reason so line can diagnose and continue', async (context) => {
  const cause = new Error('目标文件 Documents/a.md 不存在');
  context.mock.method(devices.actions, 'perform', () => Promise.reject(new Error('节点动作执行失败', { cause })));
  const result = await dispatcher(allowAll)('~/Documents/a.md', 'c1');
  assert.equal(result.outcome, 'error');
  assert.match(result.content, /节点动作执行失败/);
  assert.match(result.content, /目标文件 Documents\/a.md 不存在/);
});

test('model cannot focus window via tab_show directly; only tab_handoff may invoke it', async () => {
  const tool = createDeviceActionTool(devices.actions);
  const params = { nodeId, purpose: '看不到图片入口，切到前面看看', action: { kind: 'tab_show', tabId: 't-1' } };
  await assert.rejects(tool.execute(params as never, toolContext('call-show')),
    (error: Error & { content?: string }) => /抢他的屏幕/.test(error.content ?? ''));
  assert.equal(sent.length, 0);
  assert.equal(state.nodeActions.recent(nodeId).length, 0);
});
