// 第三级：线上的设备动作和提交前问他。设备动作的执行、权限门原样复用旧工具；提交被设备拦下后，page_submit_ask 按这条线
// 出卡、线进 waiting；他选了提交，带 submitAsk 再点一次，设备那边核对是这条线问的才放行（一次）。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import type { NodeActionEnvelope, NodeActionReport } from '../../shared/api/index.ts';
import type { DeviceActionKind } from '../../shared/state.ts';
import { autoOnlyPermissionGate, createDeviceActionGate, createDeviceActionTool } from '../../src/brain/index.ts';
import { DeviceService, submitRefusal, type NodeTransport } from '../../src/devices/index.ts';
import { adaptLegacyTool, legacySayings } from '../../src/lines/index.ts';
import { startKernel, until, type Harness } from './helpers.ts';

const TAB_KINDS: DeviceActionKind[] = ['tab_list', 'tab_open', 'tab_navigate', 'tab_read', 'tab_perceive', 'tab_act'];
const PAY_LABEL = '提交报名并支付 ¥180';

interface Rig {
  h: Harness;
  service: DeviceService;
  nodeId: string;
  sent: NodeActionEnvelope[];
}

const rigs: Rig[] = [];

afterEach(async () => {
  for (const rig of rigs.splice(0)) {
    rig.service.stop();
    await rig.h.close();
  }
});

function device(envelope: NodeActionEnvelope): Partial<NodeActionReport> {
  const action = envelope.action;
  if (action.kind === 'tab_act' && action.act.op === 'click' && action.act.n === 8 && action.submitAsk === null) {
    return { status: 'failed', error: '这一下是提交（付款），没有点。', result: { errorCode: 'submit_needs_you',
      submit: { kind: 'pay', label: PAY_LABEL }, target: { n: 8, role: 'button', name: PAY_LABEL } } };
  }
  return { result: { tabId: 'tab-race', op: 'click', target: { n: 8, role: 'button', name: 'x' },
    before: { url: 'https://race.example.cn/signup', title: 't', digest: 'a' },
    after: { url: 'https://race.example.cn/done', title: 't', digest: 'b' }, changed: true, matches: null,
    submitted: 'pay', page: { version: 'v2', url: 'https://race.example.cn/done', title: '报名成功', outline: '#',
      totalChars: 1, truncated: false, elements: [], imageHeavy: false, digest: 'c' } } };
}

async function rig(): Promise<Rig> {
  const sent: NodeActionEnvelope[] = [];
  let service: DeviceService | undefined;
  const h = await startKernel({ extra: { submits: { submitHoldForRun: (runId, nodeId, tabId) =>
    service!.actions.submitHoldForRun(runId, nodeId, tabId) } }, tools: [] });
  const transport: NodeTransport = {
    send(envelope) {
      sent.push(envelope);
      return Promise.resolve({ actionId: envelope.actionId, status: 'executed',
        executedAt: h.clock.now().toISOString(), ...device(envelope) });
    },
  };
  service = new DeviceService({ state: h.handle.state, desk: h.desk, now: h.clock.now, dryRun: false, transport });
  const at = h.clock.now().toISOString();
  const issuer = h.handle.state.devices.create({ name: '手机', firstSeenAt: at, lastSeenAt: at }).id;
  const issued = service.issueCode(issuer);
  const nodeId = service.pair(service.findCode(issued.code)!, { code: issued.code, requestId: 'pair-line',
    name: 'Alex 的 MacBook', platform: 'macos', appVersion: '1', protocolVersion: 1, capabilities: TAB_KINDS }).node.id;
  const made = { h, service, nodeId, sent };
  rigs.push(made);
  return made;
}

function lastResult(context: TranscriptContext): string {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const last = results[results.length - 1];
  return last?.role === 'toolResult' ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : '';
}

test('设备点到提交被拦下 → 提交前问他（按这条线出卡）→ 他选了提交 → 带 submitAsk 再点一次才发出', async () => {
  const r = await rig();
  const { h, nodeId } = r;
  const tool = adaptLegacyTool(createDeviceActionTool(r.service.actions), legacySayings(() => 'Mac')
    .device_action ?? { say: () => '' }, { dryRun: false, now: h.clock.now,
    permission: createDeviceActionGate(r.service.actions, autoOnlyPermissionGate, r.service.approvals) });
  // 换一个带设备动作的内核：工具在构造时定，所以重开一次（同一个库、同一张桌子的设备服务）。
  await h.kernel.stop();
  const withTools = await startKernel({ handle: h.handle, tools: [tool],
    extra: { submits: { submitHoldForRun: (runId, node, tab) => r.service.actions.submitHoldForRun(runId, node,
      tab) } } });
  rigs.push({ ...r, h: withTools });
  const click = (extra: Record<string, unknown>) => ({ nodeId, purpose: '帮他报半程马拉松', action: { kind: 'tab_act',
    tabId: 'tab-race', version: 'v1', act: { op: 'click', n: 8 }, step: `点「${PAY_LABEL}」`, submitAsk: null,
    ...extra } });
  let askId = '';
  withTools.respond([
    fauxAssistantMessage([fauxToolCall('device_action', click({}), { id: 'd1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('page_submit_ask', { nodeId, tabId: 'tab-race', version: 'v1',
      question: '要提交报名并付 ¥180 吗？', detail: '', submitOption: 'submit',
      options: [{ id: 'submit', label: '直接提交', recommended: true }, { id: 'wait', label: '等等' }] }, { id: 'p1' })],
    { stopReason: 'toolUse' }),
    (context) => {
      askId = /submitAsk=([^\s（]+)/.exec(lastResult(context))?.[1] ?? '';
      return fauxAssistantMessage([fauxToolCall('device_action', click({ submitAsk: askId }), { id: 'd2' })],
        { stopReason: 'toolUse' });
    },
    (context) => fauxAssistantMessage(`结果：${lastResult(context).slice(0, 40)}`),
  ]);
  withTools.kernel.send('main', { text: '帮我报名' });
  await until(() => withTools.kernel.view('main').status === 'waiting', '提交前在等他');
  const ask = withTools.handle.state.asks.open()[0]!;
  assert.equal(ask.runId, 'line:line-main');
  assert.equal(ask.basis, 'hard_line');
  assert.equal(ask.options.find((option) => option.id === 'submit')?.description, `提交后会：付款（「${PAY_LABEL}」）。`);
  assert.equal(r.sent.length, 1, '提交被拦下，只发过那一下');
  withTools.desk.answer({ askId: ask.id, optionId: 'submit', answerer: { deviceId: 'd' } });
  await until(() => withTools.kernel.view('main').status === 'idle', '跑完');
  assert.equal(askId, ask.id);
  assert.equal(r.sent.length, 2, '他选了提交才发第二下');
  assert.equal(r.sent[1]?.action.kind === 'tab_act' && r.sent[1].action.submitAsk, ask.id);
  const steps = withTools.kernel.read('main', 50).messages.filter((message) => message.role === 'toolResult');
  assert.equal(steps[0]?.say, '在 Mac 上帮他报半程马拉松');
  assert.equal(steps.at(-1)?.ok, true);
  const action = r.sent[1]!.action;
  assert.equal(action.kind, 'tab_act');
  if (action.kind !== 'tab_act') { throw new Error('缺少提交动作'); }
  const swapped = submitRefusal(withTools.handle.state, { nodeId, runId: 'line:line-main',
    action: { ...action, act: { op: 'enter', n: 8 } } });
  assert.match(swapped?.reason ?? '', /动作类型/);
  const row = withTools.handle.state.nodeActions.forRunNode('line:line-main', nodeId)
    .find((entry) => entry.actionId === r.sent[1]!.actionId)!;
  withTools.handle.state.nodeActions.update(row.id, row.version, { status: 'failed' });
  const replay = submitRefusal(withTools.handle.state, { nodeId, runId: 'line:line-main', action });
  assert.match(replay?.reason ?? '', /已经放行过一次/);

});
