import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import {
  ACTION_TTL_MS, createDeviceActionGate, createDeviceActionTool, DEFAULT_DEVICE_LIMITS, DeviceService,
  type ApprovedResult,
} from '../../src/devices/index.ts';
import { autoOnlyPermissionGate } from '../../src/tools/index.ts';
import { harness, type Harness } from '../attention/desk-harness.ts';

let h: Harness;
let service: DeviceService;
let nodeId: string;
let issuer: string;
let reported: ApprovedResult[];
let n = 0;

beforeEach(() => {
  h = harness();
  reported = [];
  service = new DeviceService({ state: h.state, desk: h.desk, now: h.clock.now, dryRun: false });
  h.desk.setResolver(service.approvals!.resolver);
  service.approvals!.onResult((result) => reported.push(result));
  const at = h.clock.now().toISOString();
  issuer = h.state.devices.create({ name: '测试浏览器', firstSeenAt: at, lastSeenAt: at }).id;
  const issued = service.issueCode(issuer);
  nodeId = service.pair(service.findCode(issued.code)!, { code: issued.code, requestId: 'pair-test',
    name: 'Mac', platform: 'macos', appVersion: '1', protocolVersion: 1,
    capabilities: ['file_delete', 'file_read'] }).node.id;
  service.setLimits(nodeId, 0, { ...DEFAULT_DEVICE_LIMITS, roots: ['~/Documents'] },
    { deviceId: issuer, confirmedAt: at }, (action) => action());
});
afterEach(() => {
  service.stop();
  h.close();
});

function request() {
  n += 1;
  return { actionId: `line:line-main:call-${n}`, nodeId, runId: 'line:line-main', origin: 'brain' as const,
    action: { kind: 'file_delete' as const, path: '~/Documents/old.md' } };
}

function answer(askId: string, optionId: 'allow' | 'deny'): void {
  h.desk.answer({ askId, optionId, answerer: { deviceId: issuer,
    confirmation: { deviceId: issuer, confirmedAt: h.clock.now().toISOString() } } });
}

function approve(input: ReturnType<typeof request>) {
  const ask = service.approvals!.request(input);
  answer(ask.id, 'allow');
  return ask;
}

const signal = (): AbortSignal => new AbortController().signal;

test('composite ID approval, dispatch, receipt, and tool replay bind to same safe ID', async () => {
  const input = { ...request(), actionId: 'call_approval|fc_fixture' };
  const safeId = `a-${createHash('sha256').update(input.actionId).digest('hex').slice(0, 40)}`;
  const ask = approve(input);
  assert.equal(ask.actionId, `device-approval:${safeId}`);
  assert.equal(ask.context?.actionId, safeId);
  assert.equal(ask.context?.originalActionId, input.actionId);
  assert.equal(service.approvals!.request(input).id, ask.id);
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, safeId);
  service.reportResult(nodeId, safeId, { status: 'executed', result: {} });
  assert.equal(reported.length, 1);
  assert.equal(service.actions.replayable(input), true);
  assert.equal((await service.actions.perform(input)).reused, true);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});

test('tool gate emits delete grant card, runs once on confirm, reports to line, reuses on replay', async () => {
  const input = request();
  const gate = createDeviceActionGate(service.actions, autoOnlyPermissionGate, service.approvals);
  const call = { tool: createDeviceActionTool(service.actions), actionId: input.actionId, runId: input.runId,
    args: { nodeId, purpose: '删掉过期的旧笔记', action: input.action }, signal: signal() };
  const first = await gate.check(call);
  assert.equal(first.allowed, false);
  const ask = h.state.asks.byActionId(`device-approval:${input.actionId}`)!;
  assert.equal(ask.runId, 'line:line-main');
  answer(ask.id, 'allow');
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, input.actionId);
  service.reportResult(nodeId, input.actionId, { status: 'executed', result: {} });
  assert.equal(reported.length, 1);
  assert.equal(reported[0]?.lineId, 'line-main');
  assert.match(reported[0]?.text ?? '', /做完了/);
  assert.equal((await gate.check(call)).allowed, true, '已确认的同一动作读取回执，不再次要求授权');
  assert.equal((await service.actions.perform(input)).reused, true);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});

test('denied delete grant blocks dispatch and notifies originating line', async () => {
  const input = request();
  const ask = service.approvals!.request(input);
  answer(ask.id, 'deny');
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
  assert.deepEqual(reported.map((entry) => entry.lineId), ['line-main']);
  assert.match(reported[0]?.text ?? '', /没有授权/);
});

test('timeout after grant dispatch marks unknown, tells line to verify, never resends to node', async () => {
  const input = request();
  approve(input);
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, input.actionId);
  h.clock.advance(ACTION_TTL_MS + 1);
  service.channel.sweep();
  assert.equal(h.state.nodeActions.byActionId(input.actionId)?.status, 'unknown');
  assert.match(reported.at(-1)?.text ?? '', /结果不明/);
  const replay = await service.actions.perform(input);
  assert.equal(replay.status, 'unknown');
  assert.equal(replay.reused, true);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});

test('restart resumes granted unsent actions without resending sent ones; delivers late result once', async () => {
  const queued = request();
  approve(queued);
  const sent = request();
  approve(sent);
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, queued.actionId);
  service.stop();
  service = new DeviceService({ state: h.state, desk: h.desk, now: h.clock.now, dryRun: false });
  service.approvals!.onResult((result) => reported.push(result));
  service.recover();
  assert.equal((await service.nextAction(nodeId, 0, signal()))?.id, sent.actionId);
  service.reportResult(nodeId, sent.actionId, { status: 'executed', result: {} });
  service.reportResult(nodeId, sent.actionId, { status: 'executed', result: {} });
  assert.equal(reported.filter((entry) => /做完了/.test(entry.text)).length, 1);
});

test('rolling back outer grant-card transaction leaks neither queue entry nor UI event', async () => {
  const input = request();
  const ask = service.approvals!.request(input);
  const changes: string[] = [];
  service.attach({ nodeChanged: () => undefined, actionRecorded: (row) => changes.push(row.status) });
  assert.throws(() => h.state.transaction(() => {
    h.desk.answer({ askId: ask.id, optionId: 'allow', answerer: { deviceId: issuer,
      confirmation: { deviceId: issuer, confirmedAt: h.clock.now().toISOString() } } }, () => undefined);
    throw new Error('rollback');
  }), /rollback/);
  assert.deepEqual(changes, []);
  assert.equal(h.state.nodeActions.byActionId(input.actionId), undefined);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});

test('expired unsent per-call grant replay returns failed without treating answered card as pending', async () => {
  const input = request();
  approve(input);
  h.clock.advance(ACTION_TTL_MS + 1);
  service.channel.sweep();
  await service.nextAction(nodeId, 0, signal());
  assert.equal(service.actions.replayable(input), true);
  const result = await service.actions.perform(input);
  assert.equal(result.status, 'refused');
  assert.equal(result.reused, true);
  assert.equal(await service.nextAction(nodeId, 0, signal()), null);
});
