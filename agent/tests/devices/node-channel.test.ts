import assert from 'node:assert/strict';
import { Value } from 'typebox/value';
import { DEVICE_RESULT_SCHEMAS } from '../../shared/api/index.ts';
import { afterEach, beforeEach, test } from 'node:test';
import { ACTION_TTL_MS, DEFAULT_DEVICE_LIMITS, DeviceService } from '../../src/devices/index.ts';
import { openState } from '../../src/state/index.ts';
import { device, openTestState, START, type TestState } from '../state/helpers.ts';

let t: TestState;
let now: number;
let service: DeviceService;
let nodeId: string;
const signal = (): AbortSignal => new AbortController().signal;

beforeEach(async () => {
  t = await openTestState();
  now = START;
  service = new DeviceService({ state: t.state, now: () => new Date(now), dryRun: false });
  const at = new Date(now).toISOString();
  const issuer = t.state.devices.create({ name: '测试设备', firstSeenAt: at, lastSeenAt: at });
  const issued = service.issueCode(issuer.id);
  const code = service.findCode(issued.code);
  assert.ok(code);
  nodeId = service.pair(code, { requestId: 'node-pair-test', code: issued.code, name: '测试 Mac',
    platform: 'macos', appVersion: '1', protocolVersion: 1,
    capabilities: ['file_read', 'file_write', 'file_delete', 'screen_capture'] }).node.id;
  service.setLimits(nodeId, 0, { ...DEFAULT_DEVICE_LIMITS, roots: ['~/Documents'] },
    device(issuer.id), (action) => action());
});

afterEach(async () => {
  service.stop();
  await t.cleanup();
});

function perform(id = 'read-one') {
  return service.actions.perform({ actionId: id, nodeId, origin: 'brain',
    action: { kind: 'file_read', path: '~/Documents/笔记.md' } });
}

test('长轮询在动作入队后唤醒：字段原样、取走才标 sent，同一动作只发一次', async () => {
  const poll = service.nextAction(nodeId, 25, signal());
  const done = perform();
  assert.equal(t.state.nodeActions.byActionId('read-one')?.status, 'queued');
  const action = await poll;
  assert.deepEqual(action, { id: 'read-one', kind: 'file_read', params: { path: '~/Documents/笔记.md' },
    deadline: new Date(now + ACTION_TTL_MS).toISOString() });
  assert.equal(t.state.nodeActions.byActionId('read-one')?.status, 'sent');
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
  const result = { content: '文件内容', encoding: 'utf8' as const, version: 'a'.repeat(64) };
  service.reportResult(nodeId, 'read-one', { status: 'executed', result });
  assert.deepEqual((await done).result, result);
});

test('无动作等满后返回空；每次长轮询都更新心跳，取消能释放等待', async () => {
  now += 30_000;
  assert.equal(await service.nextAction(nodeId, 0.01, signal()), null);
  assert.equal(t.state.nodes.require(nodeId).lastSeenAt, new Date(now).toISOString());
  const controller = new AbortController();
  const waiting = service.nextAction(nodeId, 25, controller.signal);
  controller.abort();
  assert.equal(await waiting, null);
});

test('同节点并发取动作只交给一个请求；另一请求和服务关闭都能结束等待', async () => {
  const left = service.nextAction(nodeId, 25, signal());
  const right = service.nextAction(nodeId, 25, signal());
  const done = perform();
  await Promise.resolve();
  service.stop();
  const replies = await Promise.all([left, right]);
  assert.equal(replies.filter((reply) => reply?.id === 'read-one').length, 1);
  assert.equal(replies.filter((reply) => reply === null).length, 1);
  await done;
});

test('未发动作不能报结果；执行结果按种类校验，拒绝覆盖已落盘的原结果', async () => {
  const done = perform();
  assert.throws(() => service.reportResult(nodeId, 'read-one', { status: 'executed', result: {} }),
    { code: 'action_conflict' });
  await service.nextAction(nodeId, 0, signal());
  assert.throws(() => service.reportResult(nodeId, 'read-one', { status: 'executed', result: { version: 'wrong' } }),
    { code: 'invalid_input' });
  service.reportResult(nodeId, 'read-one', { status: 'executed',
    result: { content: '', encoding: 'utf8', version: 'b'.repeat(64) } });
  assert.equal((await done).status, 'executed');
});

test('结果按动作 id 幂等，键顺序不同仍相同，冲突结果和别的节点都不能覆盖', async () => {
  const done = perform();
  await service.nextAction(nodeId, 0, signal());
  const body = { status: 'failed' as const, error: '读取失败，请重试。', result: { detail: 'x', code: 1 } };
  service.reportResult(nodeId, 'read-one', body);
  await done;
  const version = t.state.nodeActions.byActionId('read-one')?.version;
  service.reportResult(nodeId, 'read-one', { result: { code: 1, detail: 'x' }, error: body.error, status: 'failed' });
  assert.equal(t.state.nodeActions.byActionId('read-one')?.version, version);
  assert.throws(() => service.reportResult(nodeId, 'read-one', { ...body, error: '不同的结果' }),
    { code: 'action_conflict' });
  assert.throws(() => service.reportResult('another-node', 'read-one', body), { code: 'not_found' });
});

test('deadline 未取走记节点不可用，取走未回记 unknown，迟到结果可核实且不重发', async () => {
  const unseen = perform('unseen');
  const sent = perform('sent');
  await service.nextAction(nodeId, 0, signal());
  now += ACTION_TTL_MS + 1;
  service.channel.sweep();
  const rows = [await unseen, await sent];
  assert.deepEqual(rows.map((row) => row.status).sort(), ['refused', 'unknown']);
  const unknown = rows.find((row) => row.status === 'unknown');
  assert.ok(unknown);
  service.reportResult(nodeId, unknown.actionId, { status: 'failed', error: '读取失败' });
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});

test('重启接续保留完整未发参数，已发未回变 unknown；结果幂等记录也跨重启', async () => {
  const first = perform('first');
  const second = perform('second');
  const delivered = await service.nextAction(nodeId, 0, signal());
  assert.ok(delivered);
  service.stop();
  await Promise.all([first, second]);
  t.close();
  const reopened = openState({ path: t.path });
  service = new DeviceService({ state: reopened, now: () => new Date(now), dryRun: false });
  try {
    assert.equal(reopened.nodeActions.byActionId(delivered.id)?.status, 'unknown');
    const remaining = await service.nextAction(nodeId, 0, signal());
    assert.ok(remaining);
    assert.notEqual(remaining.id, delivered.id);
    const report = { status: 'refused' as const, error: '文件已被改过', refusalLayer: 'device' as const };
    service.reportResult(nodeId, remaining.id, report);
    service.stop();
    service = new DeviceService({ state: reopened, now: () => new Date(now), dryRun: false });
    service.reportResult(nodeId, remaining.id, report);
    assert.equal(reopened.nodeActions.byActionId(remaining.id)?.reason, '文件已被改过');
    assert.equal(await service.nextAction(nodeId, 0, signal()), null);
  } finally {
    service.stop();
    reopened.close();
  }
});

test('截图结果完整保存，不把 png 截成文本预览', async () => {
  const done = service.actions.perform({ actionId: 'capture', nodeId, origin: 'brain',
    action: { kind: 'screen_capture' } });
  await service.nextAction(nodeId, 0, signal());
  const result = { png: Buffer.alloc(12_000).toString('base64'), width: 100, height: 100 };
  service.reportResult(nodeId, 'capture', { status: 'executed', result });
  assert.deepEqual((await done).result, result);
});


const framePerception = {
  tabId: 'native:fixture', version: 'v1', url: 'http://127.0.0.1/', title: '只读', outline: '正文',
  totalChars: 2, truncated: false, elements: [], imageHeavy: false, digest: 'v1', frameCount: 1,
};

test('0.7.5框架计数回执获确认后继续取下一动作，迟到回执不重放读取', async () => {
  const node = t.state.nodes.get(nodeId)!;
  service.hello(node, { appVersion: '0.7.5', protocolVersion: 1,
    capabilities: [...node.capabilities, 'tab_perceive'] });
  const pending = service.actions.perform({ actionId: 'frame-read', nodeId, origin: 'brain',
    action: { kind: 'tab_perceive', tabId: 'native:fixture' } });
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, 'frame-read');
  now += ACTION_TTL_MS + 1;
  service.channel.sweep();
  assert.equal((await pending).status, 'unknown');
  const report = { status: 'executed' as const, result: framePerception };
  service.reportResult(nodeId, 'frame-read', report);
  service.reportResult(nodeId, 'frame-read', report);
  assert.equal(t.state.nodeActions.byActionId('frame-read')?.status, 'executed');
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
  service.hello(t.state.nodes.get(nodeId)!, { appVersion: '0.7.5', protocolVersion: 1,
    capabilities: [...node.capabilities, 'tab_perceive'] });
  const next = perform('after-frame');
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, 'after-frame');
  service.reportResult(nodeId, 'after-frame', { status: 'executed',
    result: { content: '通道继续工作', encoding: 'utf8', version: 'b'.repeat(64) } });
  assert.equal((await next).status, 'executed');
});

test('仅兼容有边界的框架计数，不放宽其他结果字段或任意属性', () => {
  assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive, framePerception), true);
  for (const frameCount of [-1, 1.5, '1', 61]) {
    assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive, { ...framePerception, frameCount }), false);
  }
  assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive,
    { ...framePerception, arbitraryExtra: '不能放行' }), false);
  const { frameCount: _, ...old } = framePerception;
  assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive, old), true);
});

test('第 15 条：Mac 不在线时建日程、建提醒、标完成排队到它上线（24 小时内），别的动作照旧当场拒', async () => {
  const at = new Date(now).toISOString();
  const issuer = t.state.devices.create({ name: '另一台设备', firstSeenAt: at, lastSeenAt: at });
  const issued = service.issueCode(issuer.id);
  const code = service.findCode(issued.code);
  assert.ok(code);
  const mac = service.pair(code, { requestId: 'node-pair-calendar', code: issued.code, name: '日历 Mac',
    platform: 'macos', appVersion: '1', protocolVersion: 1,
    capabilities: ['calendar_list', 'calendar_create', 'reminder_create', 'reminder_complete'] }).node.id;
  now += 10 * 60_000;
  const reminder = await service.actions.perform({ actionId: 'remind-1', nodeId: mac, origin: 'brain',
    action: { kind: 'reminder_create', title: '交房租', due: null, notes: null } });
  assert.equal(reminder.status, 'queued');
  assert.equal(reminder.detached, true);
  assert.match(reminder.reason ?? '', /Mac/);
  assert.equal(t.state.nodeActions.byActionId('remind-1')?.deadline,
    new Date(now + 24 * 60 * 60_000).toISOString());
  assert.equal(service.actions.hold({ nodeId: mac, origin: 'brain',
    action: { kind: 'reminder_create', title: '交房租', due: null, notes: null } }), null);
  assert.equal(service.actions.hold({ nodeId: mac, origin: 'brain',
    action: { kind: 'calendar_list', from: at, to: at } })?.why, 'offline');
  const read = await service.actions.perform({ actionId: 'list-1', nodeId: mac, origin: 'system',
    action: { kind: 'calendar_list', from: at, to: at } });
  assert.equal(read.status, 'refused');
  const action = await service.nextAction(mac, 0, signal());
  assert.equal(action?.id, 'remind-1');
});
