import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import type { DeviceActionParams, NodeActionEnvelope, NodeActionReport } from '../../shared/api/index.ts';
import type { DeviceLimits, DeviceNode } from '../../shared/state.ts';
import {
  DEFAULT_DEVICE_LIMITS,
  DeviceError,
  DeviceService,
  TransportError,
  type NodeTransport,
} from '../../src/devices/index.ts';
import { device, openTestState, type TestState } from '../state/helpers.ts';
import { assertNoPrivateText, captureLogs, PRIVATE_ERROR_TEXT } from '../safety-helpers.ts';

let t: TestState;
let clock: number;
let sent: NodeActionEnvelope[];
let answer: (envelope: NodeActionEnvelope) => Promise<NodeActionReport>;
let recorded: string[];

const START = Date.parse('2026-10-27T08:00:00.000Z');

const transport: NodeTransport = {
  send(envelope) {
    sent.push(envelope);
    return answer(envelope);
  },
};

function executed(envelope: NodeActionEnvelope): Promise<NodeActionReport> {
  return Promise.resolve({
    actionId: envelope.actionId,
    status: 'executed',
    executedAt: new Date(clock).toISOString(),
    result: { ok: true },
  });
}

function service(dryRun = false): DeviceService {
  const devices = new DeviceService({ state: t.state, now: () => new Date(clock), transport, dryRun });
  devices.attach({
    nodeChanged: () => undefined,
    actionRecorded: (row) => recorded.push(`${row.actionId}:${row.status}`),
  });
  return devices;
}

beforeEach(async () => {
  t = await openTestState();
  clock = START;
  sent = [];
  recorded = [];
  answer = executed;
});

afterEach(async () => {
  await t.cleanup();
});

function issuer(): string {
  const at = new Date(START).toISOString();
  return t.state.devices.create({ name: '我的手机', firstSeenAt: at, lastSeenAt: at }).id;
}

function pairRequest(code: string) {
  return {
    requestId: 'pair-00000001',
    code,
    name: '家里的 Mac',
    platform: 'macos' as const,
    appVersion: '0.1.0',
    protocolVersion: 1,
    capabilities: ['file_list', 'file_read', 'file_write', 'file_delete', 'run_command', 'input_click'] as const,
  };
}

function paired(devices: DeviceService, limits?: DeviceLimits): { node: DeviceNode; credential: string } {
  const { code } = devices.issueCode(issuer());
  const found = devices.findCode(code);
  assert.ok(found !== undefined);
  const request = { ...pairRequest(code), capabilities: [...pairRequest(code).capabilities] };
  const result = devices.pair(found, request);
  if (limits === undefined) {
    return result;
  }
  const node = devices.setLimits(result.node.id, 0, limits, device(), (action) => action());
  return { node, credential: result.credential };
}

function withRoots(overrides: Partial<DeviceLimits['classes']> = {}): DeviceLimits {
  return {
    ...DEFAULT_DEVICE_LIMITS,
    roots: ['~/Documents/Plasticine'],
    classes: { ...DEFAULT_DEVICE_LIMITS.classes, ...overrides },
  };
}

const READ: DeviceActionParams = { kind: 'file_read', path: '~/Documents/Plasticine/笔记.md' };

test('配对：码换长期凭证，库里只存散列，凭证和码的明文都不在库文件里', async () => {
  const devices = service();
  const { code } = devices.issueCode(issuer());
  const found = devices.findCode(code.toLowerCase().replace('-', ' '));
  assert.ok(found !== undefined, '大小写、空格不影响找码');
  const { node, credential } = devices.pair(found, { ...pairRequest(code), capabilities: ['file_read'] });
  assert.equal(devices.authenticate(credential)?.id, node.id);
  assert.notEqual(node.credentialHash, credential);
  t.close();
  const bytes = await readFile(t.path);
  const wal = await readFile(`${t.path}-wal`).catch(() => Buffer.alloc(0));
  for (const secret of [credential, code, code.replace('-', '')]) {
    assert.equal(bytes.includes(secret), false, '库文件里不该有明文');
    assert.equal(wal.includes(secret), false, 'WAL 里不该有明文');
  }
});

test('配对码过期、用过、作废都换不到凭证', () => {
  const devices = service();
  const first = devices.issueCode(issuer());
  const code = devices.findCode(first.code);
  assert.ok(code !== undefined);
  devices.pair(code, { ...pairRequest(first.code), capabilities: [] });
  const used = devices.findCode(first.code);
  assert.ok(used !== undefined);
  assert.throws(() => devices.pair(used, { ...pairRequest(first.code), capabilities: [] }), {
    name: 'DeviceError',
    code: 'pairing_code_used',
  });
  const second = devices.issueCode(issuer());
  clock += 11 * 60 * 1000;
  const late = devices.findCode(second.code);
  assert.ok(late !== undefined);
  assert.throws(() => devices.pair(late, { ...pairRequest(second.code), capabilities: [] }), {
    code: 'pairing_code_expired',
  });
  const third = devices.issueCode(issuer());
  devices.voidCode(third.codeId);
  const voided = devices.findCode(third.code);
  assert.ok(voided !== undefined);
  assert.throws(() => devices.pair(voided, { ...pairRequest(third.code), capabilities: [] }), {
    code: 'pairing_code_used',
  });
});

test('凭证失效：错的凭证认不出节点；重新发凭证后旧的那张不再算数', () => {
  const devices = service();
  const { node, credential } = paired(devices);
  assert.equal(devices.authenticate('pn1_不是这张'), undefined);
  assert.equal(devices.authenticate(''), undefined);
  const again = devices.reissue(node.id);
  assert.equal(devices.authenticate(credential), undefined);
  assert.equal(devices.authenticate(again.credential)?.id, node.id);
});

test('撤销后凭证立刻失效，之后的动作一律拒（节点不可用），不发给设备', async () => {
  const devices = service();
  const { node, credential } = paired(devices, withRoots());
  devices.revoke(node.id, 'iphone-1', (action) => action());
  assert.equal(devices.authenticate(credential), undefined);
  const outcome = await devices.actions.perform({ actionId: 'a-1', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(outcome.status, 'refused');
  assert.equal(outcome.refusalLayer, 'node');
  assert.match(outcome.reason ?? '', /已经撤销/);
  assert.equal(sent.length, 0);
});

test('第 97 条：服务端不设受保护路径，根目录、系统命令、家目录下的点文件都照发给设备', async () => {
  const devices = service();
  const { node } = paired(devices);
  const cases: DeviceActionParams[] = [
    { kind: 'file_list', path: '/' },
    { kind: 'file_list', path: '/Users' },
    { kind: 'run_command', cwd: '/tmp', command: '/bin/ls ~/Desktop' },
    { kind: 'run_command', cwd: '~', command: 'sw_vers' },
    { kind: 'file_read', path: '~/.zshrc' },
  ];
  for (const [index, action] of cases.entries()) {
    const outcome = await devices.actions.perform({ actionId: `p-${index}`, nodeId: node.id, action, origin: 'brain' });
    assert.equal(outcome.status, 'executed', JSON.stringify(action));
  }
  assert.equal(sent.length, cases.length);
});

test('相对路径、跳出起点的 .. 是参数不全，设备不替云端补', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots());
  for (const path of ['笔记.md', '~/../x']) {
    const action = { kind: 'file_read' as const, path };
    const outcome = await devices.actions.perform({ actionId: `r-${path}`, nodeId: node.id, action, origin: 'brain' });
    assert.equal(outcome.refusalLayer, 'params');
  }
});

test('设备动作超上限被拒并报告：不排队、不发出，记一行、记遥测、推给界面，原因写清哪一层', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots({ read: { mode: 'allow', perHour: 2 } }));
  for (const index of [1, 2]) {
    const request = { actionId: `ok-${index}`, nodeId: node.id, action: READ, origin: 'brain' as const };
    const outcome = await devices.actions.perform(request);
    assert.equal(outcome.status, 'executed');
  }
  const over = await devices.actions.perform({ actionId: 'over-1', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(over.status, 'refused');
  assert.equal(over.refusalLayer, 'count');
  assert.match(over.reason ?? '', /这一小时已经做了 2 次，到了上限 2 次.*不排队/);
  assert.equal(sent.length, 2);
  assert.equal(t.state.nodeActions.byActionId('over-1')?.status, 'refused');
  assert.ok(recorded.includes('over-1:refused'));
  clock += 61 * 60 * 1000;
  const fresh = t.state.nodes.require(node.id);
  devices.hello(fresh, { appVersion: fresh.appVersion, protocolVersion: fresh.protocolVersion,
    capabilities: fresh.capabilities });
  const later = await devices.actions.perform({ actionId: 'over-1', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(later.status, 'executed', '被拒的同一标识过了这一小时按现在的上限重新检查');
});

test('授权目录清单为空就是不限；设了清单，不在里面的拒', async () => {
  const devices = service();
  const { node } = paired(devices);
  const open = await devices.actions.perform({ actionId: 's-0', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(open.status, 'executed');
  const scoped = paired(devices, { ...withRoots(), roots: ['~/Projects'] }).node;
  const outcome = await devices.actions.perform({ actionId: 's-1', nodeId: scoped.id, action: READ, origin: 'brain' });
  assert.equal(outcome.refusalLayer, 'scope');
  assert.match(outcome.reason ?? '', /不在这台节点授权的目录里/);
});

test('删除默认逐次确认：删文件和删除类命令都拒，说要你确认', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots());
  const remove = { kind: 'file_delete' as const, path: '~/Documents/Plasticine/旧.md' };
  const command = { kind: 'run_command' as const, cwd: '~/Documents/Plasticine', command: 'rm -rf build' };
  for (const [id, action] of [['d-1', remove], ['d-2', command]] as const) {
    const outcome = await devices.actions.perform({ actionId: id, nodeId: node.id, action, origin: 'brain' });
    assert.equal(outcome.refusalLayer, 'confirm');
  }
  assert.equal(sent.length, 0);
});

test('重放不重做：同一个动作标识第二次到达，返回第一次的结果，不再发给设备', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots());
  const first = await devices.actions.perform({ actionId: 'same', nodeId: node.id, action: READ, origin: 'brain' });
  const second = await devices.actions.perform({ actionId: 'same', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.deepEqual(second.result, { ok: true });
  assert.equal(sent.length, 1);
  const other = { kind: 'file_read' as const, path: '~/Documents/Plasticine/别的.md' };
  await assert.rejects(
    devices.actions.perform({ actionId: 'same', nodeId: node.id, action: other, origin: 'brain' }),
    (error: unknown) => error instanceof DeviceError && error.code === 'action_conflict',
  );
});

test('发出后断了是结果不明：同一标识不再发；重启后还是结果不明', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots());
  answer = () => Promise.reject(new TransportError('连接断了', true));
  const lost = await devices.actions.perform({ actionId: 'lost', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(lost.status, 'unknown');
  answer = executed;
  const again = await devices.actions.perform({ actionId: 'lost', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(again.status, 'unknown');
  assert.equal(sent.length, 1);
  // A restart cut in after the row said 「已发出」: a fresh service over the same library still does not resend.
  const row = t.state.nodeActions.byActionId('lost');
  assert.ok(row !== undefined);
  t.state.nodeActions.update(row.id, row.version, { status: 'sent' });
  const restarted = service();
  const after = await restarted.actions.perform({ actionId: 'lost', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(after.status, 'unknown');
  assert.match(after.reason ?? '', /不再发/);
  assert.equal(sent.length, 1);
});

test('确定没送到的算没做（节点不可用）：同一标识之后可以再试', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots());
  answer = () => Promise.reject(new TransportError('节点不在线。', false));
  const offline = await devices.actions.perform({ actionId: 'off', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(offline.refusalLayer, 'node');
  answer = executed;
  const back = await devices.actions.perform({ actionId: 'off', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(back.status, 'executed');
});

test('设备按自己的上限拒了，记成「设备自己拒了」和它给的原因', async () => {
  const devices = service();
  const { node } = paired(devices, withRoots());
  answer = (envelope) => Promise.resolve({
    actionId: envelope.actionId,
    status: 'refused',
    executedAt: new Date(clock).toISOString(),
    refusal: { layer: 'scope', reason: '设备上这个目录的授权撤了。' },
  });
  const outcome = await devices.actions.perform({ actionId: 'dev', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(outcome.refusalLayer, 'device');
  assert.equal(outcome.reason, '设备上这个目录的授权撤了。');
});

test('传输异常无论是否送达，都不把原文写进日志和动作记录', async (context) => {
  const lines = captureLogs(context);
  const devices = service();
  const { node } = paired(devices, withRoots());
  for (const delivered of [false, true]) {
    answer = () => Promise.reject(new TransportError(PRIVATE_ERROR_TEXT, delivered));
    const actionId = `transport-${delivered}`;
    const outcome = await devices.actions.perform({ actionId, nodeId: node.id, action: READ, origin: 'brain' });
    assert.equal(outcome.status, delivered ? 'unknown' : 'refused');
    assertNoPrivateText([lines, outcome, t.state.nodeActions.byActionId(actionId)]);
  }
  assert.match(lines.join('\n'), /device_action_unknown/);
});

test('开发期干跑：检查照做，过了也只记录不发', async () => {
  const devices = service(true);
  const { node } = paired(devices, withRoots());
  const outcome = await devices.actions.perform({ actionId: 'dry', nodeId: node.id, action: READ, origin: 'brain' });
  assert.equal(outcome.status, 'dry_run');
  assert.equal(sent.length, 0);
  const blocked = await devices.actions.perform({
    actionId: 'dry-delete',
    nodeId: node.id,
    action: { kind: 'file_delete', path: '~/Documents/Plasticine/旧.md' },
    origin: 'brain',
  });
  assert.equal(blocked.refusalLayer, 'confirm');
});

test('上限只能带设备确认改，版本旧了拒', () => {
  const devices = service();
  const { node } = paired(devices);
  const changed = devices.setLimits(node.id, 0, withRoots(), device(), (action) => action());
  assert.equal(changed.limitsVersion, 1);
  assert.throws(() => devices.setLimits(node.id, 0, withRoots(), device(), (action) => action()), {
    code: 'version_conflict',
  });
});
