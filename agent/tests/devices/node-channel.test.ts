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

test('after 2m with newer device receipt, marks device-missed and never resends', async () => {
  const first = perform('missing-receipt');
  await service.nextAction(nodeId, 0, signal());
  now += 60_000;
  const second = perform('later-receipt');
  await service.nextAction(nodeId, 0, signal());
  service.reportResult(nodeId, 'later-receipt', { status: 'failed', error: '测试失败回执' });
  await second;
  service.channel.sweep();
  assert.equal(t.state.nodeActions.byActionId('missing-receipt')?.status, 'sent');
  now += 60_001;
  service.channel.sweep();
  const row = t.state.nodeActions.byActionId('missing-receipt')!;
  assert.equal(row.status, 'unknown');
  assert.match(row.reason ?? '', /设备没接这一步/);
  assert.match((await first).reason ?? '', /后续.*回执/);
  const replay = await perform('missing-receipt');
  assert.equal(replay.reused, true);
  assert.match(replay.reason ?? '', /设备没接这一步/);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
  service.reportResult(nodeId, 'missing-receipt', { status: 'failed', error: '迟到的真实回执' });
  assert.equal(t.state.nodeActions.byActionId('missing-receipt')?.reason, '迟到的真实回执');
});

test('stale receipt alone does not change unknown status to device-missed', async () => {
  const first = perform('earlier');
  await service.nextAction(nodeId, 0, signal());
  service.reportResult(nodeId, 'earlier', { status: 'failed', error: '此前回执' });
  await first;
  now += 1;
  const pending = perform('still-waiting');
  await service.nextAction(nodeId, 0, signal());
  for (let step = 0; step < 4; step += 1) {
    now += 30_000;
    stillDoing('still-waiting');
  }
  now += 1;
  service.channel.sweep();
  assert.equal(t.state.nodeActions.byActionId('still-waiting')?.status, 'sent');
  service.stop();
  await pending;
});

function hello(busy: { actionId: string; kind: 'file_read'; step: string; since: string } | null) {
  const node = t.state.nodes.require(nodeId);
  return service.hello(node, { appVersion: '1', protocolVersion: 1, capabilities: node.capabilities,
    ...(busy === null ? {} : { busy }) });
}

function stillDoing(actionId: string) {
  return hello({ actionId, kind: 'file_read', step: '读文件', since: new Date(START).toISOString() });
}

test('node poll tracks running, stuck past timeout, and recovered when idle again', async () => {
  const back: string[] = [];
  service.stop();
  service = new DeviceService({ state: t.state, now: () => new Date(now), dryRun: false,
    cameBack: (node) => back.push(node.id) });
  const pending = perform('slow-read');
  await service.nextAction(nodeId, 0, signal());
  stillDoing('slow-read');
  assert.equal(service.work(nodeId).state, 'busy');
  assert.equal(service.work(nodeId).step, '读文件');
  for (let step = 0; step < 4; step += 1) {
    now += 30_000;
    stillDoing('slow-read');
  }
  assert.equal(service.work(nodeId).state, 'stuck');
  assert.equal(service.listNodes()[0]?.work.state, 'stuck');
  now += 1_000;
  hello(null);
  assert.equal(service.work(nodeId).state, 'idle');
  assert.deepEqual(back, [nodeId]);
  service.stop();
  await pending;
});

test('two consecutive node polls reporting idle mark dispatched action unknown without 10m wait', async () => {
  const pending = perform('lost-one');
  await service.nextAction(nodeId, 0, signal());
  now += 20_000;
  hello(null);
  assert.equal(t.state.nodeActions.byActionId('lost-one')?.status, 'sent');
  now += 20_000;
  hello(null);
  const row = t.state.nodeActions.byActionId('lost-one')!;
  assert.equal(row.status, 'unknown');
  assert.match(row.reason ?? '', /没在做这一步/);
  assert.equal((await pending).status, 'unknown');
});

test('90s without node check-in after claim marks unknown and notes resume upon return', async () => {
  const pending = perform('gone-one');
  await service.nextAction(nodeId, 0, signal());
  now += 91_000;
  service.channel.sweep();
  const row = t.state.nodeActions.byActionId('gone-one')!;
  assert.equal(row.status, 'unknown');
  assert.match(row.reason ?? '', /90 秒没再报到/);
  await pending;
});

test('cancel voids unclaimed actions and tells node to drop in-flight ones on next poll', async () => {
  const queued = perform('cancel-queued');
  assert.equal(service.cancel('cancel-queued'), 'queued');
  assert.equal((await queued).status, 'refused');
  assert.match(t.state.nodeActions.byActionId('cancel-queued')?.reason ?? '', /取消了/);
  const running = perform('cancel-running');
  await service.nextAction(nodeId, 0, signal());
  stillDoing('cancel-running');
  assert.equal(service.cancel('cancel-running'), 'sent');
  assert.deepEqual(stillDoing('cancel-running').cancel, ['cancel-running']);
  service.reportResult(nodeId, 'cancel-running', { status: 'failed', error: '取消了', errorCode: 'cancelled' });
  await running;
  assert.equal(service.cancel('no-such'), null);
});

test('post-restart unknown action never resends; only later receipt from same node clarifies it', async () => {
  const pending = perform('old-unknown');
  await service.nextAction(nodeId, 0, signal());
  service.stop();
  await pending;
  service = new DeviceService({ state: t.state, now: () => new Date(now), dryRun: false });
  assert.equal(t.state.nodeActions.byActionId('old-unknown')?.status, 'unknown');
  now += 120_001;
  const issuer = t.state.devices.list()[0]!;
  const code = service.issueCode(issuer.id);
  const other = service.pair(service.findCode(code.code)!, { requestId: 'pair-other-test', code: code.code,
    name: '另一台测试电脑', platform: 'windows', appVersion: '1', protocolVersion: 1,
    capabilities: ['file_read'] }).node;
  const otherDone = service.actions.perform({ actionId: 'other-receipt', nodeId: other.id, origin: 'brain',
    action: { kind: 'file_read', path: '~/Documents/笔记.md' } });
  await service.nextAction(other.id, 0, signal());
  service.reportResult(other.id, 'other-receipt', { status: 'failed', error: '另一台设备的回执' });
  await otherDone;
  assert.doesNotMatch(t.state.nodeActions.byActionId('old-unknown')?.reason ?? '', /设备没接这一步/);
  await service.nextAction(nodeId, 0, signal());
  const later = perform('same-device-receipt');
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, 'same-device-receipt');
  service.reportResult(nodeId, 'same-device-receipt', { status: 'failed', error: '同设备的真实回执' });
  await later;
  const replay = await perform('old-unknown');
  assert.equal(replay.reused, true);
  assert.equal(replay.status, 'unknown');
  assert.match(replay.reason ?? '', /设备没接这一步/);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});

test('long-poll wakes on enqueue, delivers fields verbatim, marks sent on claim, sends once', async () => {
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

test('long-poll returns empty on timeout, updates heartbeat each poll, releases on abort', async () => {
  now += 30_000;
  assert.equal(await service.nextAction(nodeId, 0.01, signal()), null);
  assert.equal(t.state.nodes.require(nodeId).lastSeenAt, new Date(now).toISOString());
  const controller = new AbortController();
  const waiting = service.nextAction(nodeId, 25, controller.signal);
  controller.abort();
  assert.equal(await waiting, null);
});

test('concurrent polls for same node deliver to one request; sibling poll or shutdown cancels wait', async () => {
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

test('unsent action rejects result; validates result by kind; refuses overwriting stored result', async () => {
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

test('action result is idempotent by ID regardless of key order; rejects conflicts and other nodes', async () => {
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

test('unclaimed deadline marks unavailable; claimed timeout marks unknown; late result verifies once', async () => {
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

test('restart preserves unsent args, marks sent-unanswered unknown, keeps result idempotency', async () => {
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

test('screenshot result saves full PNG without truncating to text preview', async () => {
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

test('0.7.5 frame-count receipt advances to next action; late receipt does not replay read', async () => {
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

test('compat allows bounded frame count only without relaxing other result fields or extra props', () => {
  assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive, framePerception), true);
  for (const frameCount of [-1, 1.5, '1', 61]) {
    assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive, { ...framePerception, frameCount }), false);
  }
  assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive,
    { ...framePerception, arbitraryExtra: '不能放行' }), false);
  const { frameCount: _, ...old } = framePerception;
  assert.equal(Value.Check(DEVICE_RESULT_SCHEMAS.tab_perceive, old), true);
});

test('offline Mac queues create event/reminder/complete up to 24h; other actions still fail fast', async () => {
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
