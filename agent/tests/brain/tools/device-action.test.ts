import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { NodeActionEnvelope } from '../../../shared/api/index.ts';
import {
  autoOnlyPermissionGate,
  createDeviceActionGate,
  createDeviceActionTool,
  createDeviceNodesTool,
  type PermissionGate,
} from '../../../src/brain/index.ts';
import { DEFAULT_DEVICE_LIMITS, DeviceService } from '../../../src/devices/index.ts';
import { adaptLegacyTool } from '../../../src/lines/index.ts';
import type { StateService } from '../../../src/state/index.ts';
import { FIXED_NOW, memoryState, toolContext } from '../helpers.ts';

// 设备工具经新内核的旧工具适配层（lines/legacy.ts）调用：权限门（上限、在线、逐次确认）在那里，和线上一样。
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

test('脑能发现配对节点、在线状态、能力与当前上限，不拿到节点凭证散列', async () => {
  const answer = await createDeviceNodesTool(devices).execute({}, toolContext('nodes'));
  const [node] = JSON.parse(answer) as Record<string, unknown>[];
  assert.equal(node?.['id'], nodeId);
  assert.equal(node?.['online'], true);
  assert.deepEqual(node?.['capabilities'], ['file_read']);
  assert.ok(node?.['limits']);
  assert.ok(!answer.includes('credential'));
});

type Outcome = { outcome: 'ok' | 'error'; content: string };

/** 主线上调一次设备工具，经旧工具适配层（权限门在那里）。 */
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

test('脑的设备动作超上限：当场拒，原因作为工具结果回给脑，记一行被拒，不发给设备', async () => {
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

test('已配对在线节点的上限内动作直接执行，不被通用约定门槛挡住；服务端不设受保护路径', async () => {
  // 以前 `**/.env` 算受保护路径；现在授权目录里的都照发。
  const dotfile = await dispatcher(autoOnlyPermissionGate)('~/Documents/.env', 'c1');
  assert.equal(dotfile.outcome, 'ok');
  assert.equal(sent.length, 1);
});

test('离线节点不直接执行，原因明确为节点离线', async () => {
  const node = state.nodes.require(nodeId);
  state.nodes.update(node.id, node.version, { lastSeenAt: new Date(FIXED_NOW.getTime() - 90_001).toISOString() });
  const result = await dispatcher(autoOnlyPermissionGate)('~/Documents/a.md', 'c1');
  assert.match(result.content, /离线/);
  assert.equal(sent.length, 0);
});

test('同一个调用重放（哪怕这一小时的次数已经用完）：复用上一次的结果，设备只做一次', async () => {
  const run = dispatcher(allowAll);
  const first = await run('~/Documents/a.md', 'c1');
  const again = await run('~/Documents/a.md', 'c1');
  assert.equal(first.outcome, 'ok');
  assert.equal(again.outcome, 'ok');
  assert.equal(sent.length, 1);
});

test('设备工具失败保留实际异常和原因，便于那条线定位后继续', async (context) => {
  const cause = new Error('目标文件 Documents/a.md 不存在');
  context.mock.method(devices.actions, 'perform', () => Promise.reject(new Error('节点动作执行失败', { cause })));
  const result = await dispatcher(allowAll)('~/Documents/a.md', 'c1');
  assert.equal(result.outcome, 'error');
  assert.match(result.content, /节点动作执行失败/);
  assert.match(result.content, /目标文件 Documents\/a.md 不存在/);
});
