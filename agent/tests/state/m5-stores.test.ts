import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { DeviceLimits, NodeActionInput, NodeInput } from '../../shared/state.ts';
import { device, forged, openTestState, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

const AT = '2026-10-27T08:00:00.000Z';

const LIMITS: DeviceLimits = {
  roots: ['~/Documents'],
  apps: [],
  sites: [],
  unattendedInput: true,
  classes: {
    read: { mode: 'allow', perHour: 10 },
    write: { mode: 'allow', perHour: 10 },
    delete: { mode: 'confirm_each', perHour: 1 },
    command: { mode: 'allow', perHour: 10 },
    browser: { mode: 'allow', perHour: 10 },
    input: { mode: 'allow', perHour: 10 },
  },
};

function nodeInput(overrides: Partial<NodeInput> = {}): NodeInput {
  return {
    name: '家里的 Mac',
    platform: 'macos',
    appVersion: '0.1.0',
    protocolVersion: 1,
    capabilities: ['file_read'],
    credentialHash: 'a'.repeat(64),
    pairingCodeId: 'code-1',
    pairedAt: AT,
    lastSeenAt: AT,
    ...overrides,
  };
}

function actionInput(overrides: Partial<NodeActionInput> = {}): NodeActionInput {
  return {
    actionId: 'act-1',
    nodeId: 'node-1',
    kind: 'file_read',
    actionClass: 'read',
    target: '~/Documents/a.md',
    paramsDigest: 'b'.repeat(64),
    status: 'sent',
    origin: 'brain',
    requestedAt: AT,
    ...overrides,
  };
}

test('新配对的节点用默认上限（limits 为空、版本 0），按凭证散列查得到', () => {
  const node = t.state.nodes.create(nodeInput());
  assert.equal(node.limits, null);
  assert.equal(node.limitsVersion, 0);
  assert.equal(t.state.nodes.findByCredentialHash('a'.repeat(64))?.id, node.id);
});

test('节点上限是用户确认字段：普通写入拒，带设备确认的写入记下确认它的设备', () => {
  const node = t.state.nodes.create(nodeInput());
  const patch = forged<Parameters<typeof t.state.nodes.update>[2]>({ limits: LIMITS, limitsVersion: 1 });
  throwsState(() => t.state.nodes.update(node.id, node.version, patch), 'confirmation_required');
  const created = forged<NodeInput>({ ...nodeInput({ credentialHash: 'c'.repeat(64) }), limits: LIMITS });
  throwsState(() => t.state.nodes.create(created), 'confirmation_required');
  const confirmed = t.state.nodes.confirmLimits(node.id, node.version, { limits: LIMITS, limitsVersion: 1 }, device());
  assert.deepEqual(confirmed.limits, LIMITS);
  assert.equal(confirmed.confirmedByDeviceId, 'iphone-1');
});

test('节点配对码只能用一次，作废的也不能用', () => {
  const issuer = t.state.devices.create({ name: '手机', firstSeenAt: AT, lastSeenAt: AT }).id;
  const code = t.state.nodePairingCodes.issue({ codeHash: 'd'.repeat(64), expiresAt: AT, issuedByDeviceId: issuer });
  const node = t.state.nodes.create(nodeInput({ pairingCodeId: code.id }));
  t.state.nodePairingCodes.markUsed(code.id, AT, node.id);
  throwsState(() => t.state.nodePairingCodes.markUsed(code.id, AT, node.id), 'duplicate');
  const other = t.state.nodePairingCodes.issue({ codeHash: 'e'.repeat(64), expiresAt: AT, issuedByDeviceId: issuer });
  t.state.nodePairingCodes.void(other.id, AT);
  throwsState(() => t.state.nodePairingCodes.markUsed(other.id, AT, node.id), 'duplicate');
});

test('设备动作按动作标识只记一行；每小时次数只数发出过的，被拒的不算', () => {
  t.state.nodeActions.record(actionInput());
  throwsState(() => t.state.nodeActions.record(actionInput()), 'duplicate');
  t.state.nodeActions.record(actionInput({ actionId: 'act-2', status: 'refused', refusalLayer: 'count' }));
  t.state.nodeActions.record(actionInput({ actionId: 'act-3', status: 'executed' }));
  t.state.nodeActions.record(actionInput({ actionId: 'act-4', requestedAt: '2026-10-27T06:00:00.000Z' }));
  assert.equal(t.state.nodeActions.countSince('node-1', 'read', '2026-10-27T07:00:00.000Z'), 2);
  assert.equal(t.state.nodeActions.byActionId('act-2')?.refusalLayer, 'count');
  assert.equal(t.state.nodeActions.recent('node-1').length, 4);
});
