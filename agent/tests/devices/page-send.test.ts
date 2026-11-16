// 网页里以他的名义发出去走承诺和授权（11-16）：后台线里点发送被设备拦下 → page_send → 第一次出一张对外授权卡，
// 默认放行这件事期间、这个网站上同样的原文 → 他确认一次 → 发出；同一件事里再发同样的原文不再出卡；换了原文再问。
// 付款这一类不走 page_send。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type JsonObject } from '@earendil-works/pi-ai';
import type { NodeActionEnvelope, NodeActionReport } from '../../shared/api/index.ts';
import type { DeviceActionKind } from '../../shared/state.ts';
import { autoOnlyPermissionGate } from '../../src/tools/index.ts';
import {
  createDeviceActionGate, createDeviceActionTool, createPageSendTool, DeviceService, type NodeTransport,
} from '../../src/devices/index.ts';
import { adaptLegacyTool, legacySayings } from '../../src/lines/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { startKernel, until, type Harness } from '../lines/helpers.ts';

const TAB_KINDS: DeviceActionKind[] = ['tab_list', 'tab_perceive', 'tab_act'];
const CHAT = 'https://www.example-jobs.com/web/geek/chat';
const GREETING = '您好，方便发您简历看看吗？';
const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
});

/** 招聘网站的聊天页：填照填；点「发送」（编号 8）不带放行就拦下，「付费置顶」（编号 9）是付款。 */
function site(envelope: NodeActionEnvelope): Partial<NodeActionReport> {
  const action = envelope.action;
  if (action.kind !== 'tab_act') {
    return { result: {} };
  }
  const state = { url: CHAT, title: '聊天', digest: 'a' };
  if (action.act.op === 'click' && action.submitAsk === null && (action.act.n === 8 || action.act.n === 9)) {
    const pay = action.act.n === 9;
    return { status: 'failed', error: '这一下是提交，没有点。', result: { errorCode: 'submit_needs_you',
      submit: { kind: pay ? 'pay' : 'publish', label: pay ? '付费置顶' : '发送' },
      target: { n: action.act.n, role: 'button', name: pay ? '付费置顶' : '发送' } } };
  }
  return { result: { tabId: action.tabId, op: action.act.op, target: { n: 8, role: 'button', name: '发送' },
    before: state, after: state, changed: true, matches: action.act.op === 'fill' ? true : null,
    submitted: action.act.op === 'click' ? 'publish' : null,
    page: { version: 'v1', url: CHAT, title: '聊天', outline: '#', totalChars: 1, truncated: false, elements: [],
      imageHeavy: false, digest: 'a' } } };
}

interface Rig { h: Harness; nodeId: string; sent: NodeActionEnvelope[] }

async function rig(): Promise<Rig> {
  const sent: NodeActionEnvelope[] = [];
  const first = await startKernel({ tools: [] });
  let h: Harness | undefined;
  const now = (): Date => (h ?? first).clock.now();
  const transport: NodeTransport = {
    send(envelope) {
      sent.push(envelope);
      return Promise.resolve({ actionId: envelope.actionId, status: 'executed', executedAt: now().toISOString(),
        ...site(envelope) });
    },
  };
  const service = new DeviceService({ state: first.handle.state, desk: first.desk, now, dryRun: false, transport });
  const at = first.clock.now().toISOString();
  const issuer = first.handle.state.devices.create({ name: '手机', firstSeenAt: at, lastSeenAt: at }).id;
  const issued = service.issueCode(issuer);
  const nodeId = service.pair(service.findCode(issued.code)!, { code: issued.code, requestId: 'pair-mac',
    name: '示例 MacBook', platform: 'macos', appVersion: '1', protocolVersion: 1, capabilities: TAB_KINDS }).node.id;
  await first.kernel.stop();
  const sayings = legacySayings(() => 'Mac');
  const options = { dryRun: false, now };
  const device = adaptLegacyTool(createDeviceActionTool(service.actions), sayings.device_action!, { ...options,
    permission: createDeviceActionGate(service.actions, autoOnlyPermissionGate, service.approvals) });
  const send = adaptLegacyTool(createPageSendTool(first.handle.state, service.actions), sayings.page_send!, options);
  h = await startKernel({ handle: first.handle, tools: [device, send], extra: {
    submits: { submitHoldForRun: (runId, node, tab) => service.actions.submitHoldForRun(runId, node, tab) } } });
  closers.push(async () => {
    service.stop();
    await h!.close();
  });
  return { h, nodeId, sent };
}

function steps(nodeId: string, id: string, text: string, n = 8): ReturnType<typeof fauxAssistantMessage>[] {
  const act = (act: JsonObject): JsonObject => ({ nodeId, purpose: '打招呼', action: { kind: 'tab_act',
    tabId: 'tab-chat', version: 'v1', act, step: '打招呼', submitAsk: null } });
  return [
    fauxAssistantMessage([fauxToolCall('device_action', act({ op: 'fill', n: 5, value: text }), { id: `${id}-f` })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('device_action', act({ op: 'click', n }), { id: `${id}-c` })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('page_send', { nodeId, tabId: 'tab-chat', version: 'v1',
      site: 'www.example-jobs.com', to: `HR ${id}`, text }, { id: `${id}-s` })], { stopReason: 'toolUse' }),
  ];
}

const clicked = (sent: NodeActionEnvelope[]): number => sent.filter((envelope) => envelope.action.kind === 'tab_act'
  && envelope.action.act.op === 'click' && envelope.action.submitAsk !== null).length;

test('网页发送开头确认一次整件事，之后同样的原文直接发，换了原文再问', async () => {
  const { h, nodeId, sent } = await rig();
  const line = h.kernel.open({ title: '海投打招呼', goal: '给成都岗位打招呼', parentLineId: MAIN_LINE_ID,
    projectId: null });
  h.respond([...steps(nodeId, 'a', GREETING), fauxAssistantMessage('第一个发了')]);
  await until(() => h.handle.state.asks.open().length === 1, '第一次出对外授权卡');
  const card = h.handle.state.asks.open()[0]!;
  const grant = Reflect.get(card.context!['outbound'] as object, 'grant') as Record<string, unknown>;
  assert.deepEqual(grant['scope'], { kind: 'task', binding: { kind: 'line', id: line.id } });
  assert.equal(grant['recipientMode'], 'all');
  assert.deepEqual(grant['fixedTexts'], [GREETING]);
  assert.equal(grant['channel'], 'web:example-jobs.com');
  h.desk.answer({ askId: card.id, optionId: 'allow', answerer: { deviceId: 'device-mac' } });
  await until(() => h.kernel.view(line.id).status === 'idle', '第一个发完');
  assert.equal(clicked(sent), 1);

  h.respond([...steps(nodeId, 'b', GREETING), fauxAssistantMessage('第二个发了')]);
  h.kernel.send(line.id, { text: '接着发下一个' });
  await until(() => h.kernel.view(line.id).status === 'idle', '第二个不问直接发');
  assert.equal(clicked(sent), 2);
  assert.equal(h.handle.state.asks.open().length, 0);
  assert.equal(h.handle.state.outboundGrants.list().length, 1);
  assert.equal(h.handle.state.outboundLog.list().length, 2);

  h.respond([...steps(nodeId, 'c', '换一段话'), fauxAssistantMessage('等他定')]);
  h.kernel.send(line.id, { text: '换一段话发' });
  await until(() => h.handle.state.asks.open().length === 1, '换了原文要再问');
  assert.equal(clicked(sent), 2);
});

test('付款这一类不走 page_send', async () => {
  const { h, nodeId, sent } = await rig();
  const line = h.kernel.open({ title: '置顶', goal: '试试置顶', parentLineId: MAIN_LINE_ID, projectId: null });
  h.respond([...steps(nodeId, 'p', GREETING, 9), fauxAssistantMessage('没发')]);
  await until(() => h.handle.state.asks.open().length === 1 || h.kernel.view(line.id).status === 'idle', '停下');
  for (const ask of h.handle.state.asks.open()) {
    h.desk.answer({ askId: ask.id, optionId: 'allow', answerer: { deviceId: 'device-mac' } });
  }
  await until(() => h.kernel.view(line.id).status === 'idle', '这一轮结束');
  assert.equal(clicked(sent), 0);
  const results = h.handle.state.lineMessages.after(line.id, 0).filter((row) => row.role === 'toolResult');
  assert.match(JSON.stringify(results.at(-1)?.message), /付款、删除或改设置/);
});

test('拦下发送以后线又在这个标签上填过（哪怕是同一段话）：不放行，要重新点发送', async () => {
  const { h, nodeId, sent } = await rig();
  const line = h.kernel.open({ title: '海投打招呼', goal: '给成都岗位打招呼', parentLineId: MAIN_LINE_ID,
    projectId: null });
  const [fill, click, send] = steps(nodeId, 't', GREETING);
  // 设备上的编号不再绑整页（11-16）：拦下以后脑自己动过这个标签（比如点进另一位的会话再填同一段），旧的拦下不作数。
  const refill = fauxAssistantMessage([fauxToolCall('device_action', { nodeId, purpose: '再填一次',
    action: { kind: 'tab_act', tabId: 'tab-chat', version: 'v1', act: { op: 'fill', n: 5, value: GREETING },
      step: '再填一次', submitAsk: null } }, { id: 't-r' })], { stopReason: 'toolUse' });
  h.respond([fill!, click!, refill, send!, fauxAssistantMessage('没发')]);
  await until(() => h.handle.state.asks.open().length === 1 || h.kernel.view(line.id).status === 'idle', '停下');
  for (const ask of h.handle.state.asks.open()) {
    h.desk.answer({ askId: ask.id, optionId: 'allow', answerer: { deviceId: 'device-mac' } });
  }
  await until(() => h.kernel.view(line.id).status === 'idle', '这一轮结束');
  assert.equal(clicked(sent), 0);
  const results = h.handle.state.lineMessages.after(line.id, 0).filter((row) => row.role === 'toolResult');
  assert.match(JSON.stringify(results.at(-1)?.message), /又点过、填过或换过页/);
});
