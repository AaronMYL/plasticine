// 抖音续火花（11-07 他让 Plasticine 建、当时建不成的那条）：主对话起草定时卡 → 他在卡上确认 → 到点定时线开跑 → 在抖音
// 网页私信里填表情、点发送被设备拦下 → 照卡放行（核过对谁、发什么、在哪个网站）→ 带放行编号再点一次才发出；
// 名单外的人照拦；每次照卡发送都记下是哪张卡、哪次确认。硬线放行的最后一道（devices/page-submits.ts）也核这一下。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall, type TranscriptContext } from '@earendil-works/pi-ai';
import { MAIN_LINE_ALIAS, type NodeActionEnvelope, type NodeActionReport } from '../../shared/api/index.ts';
import type { DeviceActionKind } from '../../shared/state.ts';
import { autoOnlyPermissionGate, createDeviceActionGate, createDeviceActionTool, ensureDefaultProjects }
  from '../../src/brain/index.ts';
import { DeviceService, submitRefusal, type NodeTransport } from '../../src/devices/index.ts';
import { adaptLegacyTool, legacySayings } from '../../src/lines/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { Mates } from '../../src/mates/service.ts';
import { contentAllowed, siteAllowed, Tasks } from '../../src/tasks/index.ts';
import { startKernel, until, type Harness } from '../lines/helpers.ts';

const TAB_KINDS: DeviceActionKind[] = ['tab_list', 'tab_open', 'tab_navigate', 'tab_read', 'tab_perceive', 'tab_act'];
const CHAT = 'https://www.douyin.com/chat?isPopup=1';
const FRIENDS = ['小林', '阿杰', 'Mia', '周周', '老陈', 'Kiki', '阿北', '豆豆'];

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) {
    await close();
  }
});

function page(version: string) {
  return { version, url: CHAT, title: '抖音私信', outline: '#', totalChars: 1, truncated: false, elements: [],
    imageHeavy: false, digest: version };
}

/** 抖音网页私信：填字照填；点「发送」不带放行就拦下（发出去），带了才点。 */
function douyin(envelope: NodeActionEnvelope): Partial<NodeActionReport> {
  const action = envelope.action;
  if (action.kind !== 'tab_act') {
    return { result: {} };
  }
  if (action.act.op === 'click' && action.act.n === 8 && action.submitAsk === null) {
    return { status: 'failed', error: '这一下是发出去，没有点。', result: { errorCode: 'submit_needs_you',
      submit: { kind: 'publish', label: '发送' }, target: { n: 8, role: 'button', name: '发送' } } };
  }
  const state = { url: CHAT, title: '抖音私信', digest: 'a' };
  return { result: { tabId: action.tabId, op: action.act.op, target: { n: 8, role: 'button', name: '发送' },
    before: state, after: state, changed: true, matches: action.act.op === 'fill' ? true : null,
    submitted: action.act.op === 'click' ? 'publish' : null, page: page('v1') } };
}

function lastResult(context: TranscriptContext): string {
  const results = context.messages.filter((message) => message.role === 'toolResult');
  const last = results[results.length - 1];
  return last?.role === 'toolResult' ? last.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
    : '';
}

interface Rig {
  h: Harness;
  tasks: Tasks;
  service: DeviceService;
  nodeId: string;
  sent: NodeActionEnvelope[];
}

async function rig(): Promise<Rig> {
  const sent: NodeActionEnvelope[] = [];
  const first = await startKernel({ tools: [] });
  ensureDefaultProjects(first.handle.state);
  let h: Harness | undefined;
  // 设备、定时和内核同一个钟（重开内核换了钟，跟着新的走）。
  const now = (): Date => (h ?? first).clock.now();
  const transport: NodeTransport = {
    send(envelope) {
      sent.push(envelope);
      return Promise.resolve({ actionId: envelope.actionId, status: 'executed',
        executedAt: now().toISOString(), ...douyin(envelope) });
    },
  };
  const service = new DeviceService({ state: first.handle.state, desk: first.desk, now,
    dryRun: false, transport });
  const at = first.clock.now().toISOString();
  const issuer = first.handle.state.devices.create({ name: '手机', firstSeenAt: at, lastSeenAt: at }).id;
  const issued = service.issueCode(issuer);
  const nodeId = service.pair(service.findCode(issued.code)!, { code: issued.code, requestId: 'pair-mac',
    name: 'Alex 的 MacBook', platform: 'macos', appVersion: '1', protocolVersion: 1, capabilities: TAB_KINDS }).node.id;
  await first.kernel.stop();
  const tasks = new Tasks({ state: first.handle.state, now,
    scheduleLines: () => ({
      open: (input) => h!.kernel.open({ ...input, parentLineId: null }).id,
      send: (lineId, text, origin) => {
        h!.kernel.send(lineId, { text, origin });
      },
      view: (lineId) => (h!.handle.state.lines.get(lineId) === undefined ? null : h!.kernel.view(lineId)),
      halt: (lineId) => {
        h!.kernel.halt(lineId);
      },
    }),
    suggestionLines: () => ({ open: (input) => h!.kernel.open({ ...input, parentLineId: MAIN_LINE_ID }).id }) });
  const device = adaptLegacyTool(createDeviceActionTool(service.actions), legacySayings(() => 'Mac')
    .device_action ?? { say: () => '' }, { dryRun: false, now,
    permission: createDeviceActionGate(service.actions, autoOnlyPermissionGate, service.approvals) });
  h = await startKernel({ handle: first.handle, tools: [device, ...tasks.tools()], extra: {
    askTools: tasks.askTools(),
    submits: { submitHoldForRun: (runId, node, tab) => service.actions.submitHoldForRun(runId, node, tab) },
    turnEnded: (line) => tasks.ended(line.id) } });
  closers.push(async () => {
    service.stop();
    await h!.close();
  });
  return { h, tasks, service, nodeId, sent };
}

async function scheduleRoundTrip(asMate: boolean) {
  const { h, tasks, nodeId, sent } = await rig();
  const mate = asMate ? new Mates(h.handle.state, () => h.kernel).create({ name: '联络队友', role: '按名单联络',
    avatar: '联', hue: 'sky', soul: '只按确认的名单和原文发送。', purpose: null }) : null;
  const source = mate?.lineId ?? MAIN_LINE_ALIAS;
  // 2026-11-05T08:00Z 是北京时间 16:00：今天 15:00 过了，第一次是明天 15:00。
  h.respond([
    fauxAssistantMessage([fauxToolCall('schedule_propose', { title: '抖音续火花',
      goal: '在抖音网页私信里给名单上的每位好友各发一个表情，续火花。', cadence: { type: 'daily', at: '15:00' },
      place: '你的 Mac（不在线就等上线补发，当天 23:00 前）',
      outward: { channel: '抖音私信', site: 'douyin.com', recipients: FRIENDS, content: { kind: 'emoji' },
        contentLabel: '每人一个表情，每天随机换' } }, { id: 'p1' })], { stopReason: 'toolUse' }),
    (context) => fauxAssistantMessage(`好：${lastResult(context).slice(0, 30)}`),
  ]);
  h.kernel.send(source, { text: '帮我加一个定时任务，每天下午 3 点，抖音聊天里面，帮我给 8 个人续火花' });
  await until(() => h.handle.state.asks.open().length === 1, '对话里出定时卡');
  const card = h.handle.state.asks.open()[0]!;
  assert.equal(card.kind, 'approve');
  assert.equal(card.basis, 'hard_line');
  assert.equal(card.options[0]?.label, '确认，每天照做');
  assert.equal(card.options[1]?.label, '改名单');
  assert.match(card.detail ?? '', /^确认后，每天会以你的名义发出。只发给这 8 位、每人一个表情，每天随机换；超出这张卡的，照旧先问你。/);
  const preview = card.context?.['schedule'] as Record<string, unknown>;
  assert.deepEqual(preview['who'], FRIENDS);
  assert.equal(preview['when'], '每天 15:00');
  assert.equal(preview['projectName'], '个人');
  const draft = h.handle.state.schedules.listed()[0]!;
  assert.equal(draft.status, 'draft');
  h.desk.answer({ askId: card.id, optionId: 'confirm', answerer: { deviceId: 'device-mac' } });
  await until(() => h.kernel.view(source).status === 'idle', '发起对话接着说完');
  const schedule = h.handle.state.schedules.require(draft.id);
  assert.equal(schedule.status, 'active');
  assert.equal(schedule.confirmAskId, card.id);
  assert.equal(schedule.confirmedByDeviceId, 'device-mac');
  assert.equal(schedule.nextAt, '2026-11-06T07:00:00.000Z');
  const main = h.kernel.read(source, 50).messages;
  assert.match(main.at(-1)?.text ?? '', /他确认了/);

  let permit = '';
  let refusal = '';
  const fill = { nodeId, purpose: '续火花', action: { kind: 'tab_act', tabId: 'tab-dm', version: 'v1',
    act: { op: 'fill', n: 5, value: '🔥' }, step: '填一个表情', submitAsk: null } };
  const click = (submitAsk: string | null) => ({ nodeId, purpose: '续火花', action: { kind: 'tab_act',
    tabId: 'tab-dm', version: 'v1', act: { op: 'click', n: 8 }, step: '点「发送」', submitAsk } });
  h.respond([
    fauxAssistantMessage([fauxToolCall('device_action', fill, { id: 'f1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('device_action', click(null), { id: 'c1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('schedule_send', { nodeId, tabId: 'tab-dm', version: 'v1', recipient: '小林',
      content: '🔥' }, { id: 's1' })], { stopReason: 'toolUse' }),
    (context) => {
      permit = /submitAsk=(\S+)/.exec(lastResult(context))?.[1] ?? '';
      return fauxAssistantMessage([fauxToolCall('device_action', click(permit), { id: 'c2' })],
        { stopReason: 'toolUse' });
    },
    fauxAssistantMessage([fauxToolCall('schedule_send', { nodeId, tabId: 'tab-dm', version: 'v1',
      recipient: '陌生人', content: '🔥' }, { id: 's2' })], { stopReason: 'toolUse' }),
    (context) => {
      refusal = lastResult(context);
      return fauxAssistantMessage([fauxToolCall('line_outcome', { done: true }, { id: 'o1' })],
        { stopReason: 'toolUse' });
    },
    fauxAssistantMessage('发给小林了。'),
  ]);
  // 第二天 15:00。
  h.clock.advance(23 * 60 * 60 * 1000);
  // Mac 在线（刚报过一次）。
  const node = h.handle.state.nodes.get(nodeId)!;
  h.handle.state.nodes.update(node.id, node.version, { lastSeenAt: h.clock.now().toISOString() });
  tasks.schedules.tick();
  const lineId = h.handle.state.schedules.require(schedule.id).lineId!;
  assert.ok(lineId);
  await until(() => h.handle.state.lines.get(lineId)?.status === 'idle', '定时线跑完');
  assert.match(permit, /.+/);
  assert.equal(sent.length, 3, '填一次、被拦一次、照卡放行后发出一次');
  const released = sent[2]!.action;
  assert.equal(released.kind === 'tab_act' && released.submitAsk, permit);
  assert.match(refusal, /「陌生人」不在卡上的名单里/);
  const audit = h.handle.state.scheduleSends.forSchedule(schedule.id);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.confirmAskId, card.id);
  assert.equal(audit[0]?.confirmedByDeviceId, 'device-mac');
  assert.equal(audit[0]?.recipient, '小林');
  assert.equal(audit[0]?.runAt, '2026-11-06T07:00:00.000Z');
  assert.equal(audit[0]?.pageUrl, CHAT);
  const grant = h.handle.state.outboundGrants.bySchedule(schedule.id)!;
  assert.equal(grant.actor, mate?.id ?? MAIN_LINE_ID);
  assert.equal(grant.legacyScheduleId, schedule.id);
  assert.deepEqual(grant.scope, { kind: 'task', binding: { kind: 'schedule', id: schedule.id } });
  const outbound = h.handle.state.outboundLog.list(grant.id);
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0]?.status, 'completed');
  assert.equal(outbound[0]?.actor, mate?.id ?? MAIN_LINE_ID);
  assert.equal(h.handle.state.lines.require(lineId).mateId, mate?.id ?? null);
  assert.equal(outbound[0]?.content, audit[0]?.content);
  const after = h.handle.state.schedules.require(schedule.id);
  assert.equal(after.lastOutcome, 'done');

  // 硬线最后一道：同一个放行不能用第二次；卡停了就不认。
  if (released.kind !== 'tab_act') {
    throw new Error('缺少发送动作');
  }
  const again = submitRefusal(h.handle.state, { nodeId, runId: `line:${lineId}`, action: released });
  assert.match(again?.reason ?? '', /已经用过一次/);
  const otherLine = submitRefusal(h.handle.state, { nodeId, runId: 'line:line-main', action: released });
  assert.match(otherLine?.reason ?? '', /不是这条线的/);
  tasks.schedules.setEnabled(schedule.id, false);
  const paused = submitRefusal(h.handle.state, { nodeId, runId: `line:${lineId}`, action: released });
  assert.match(paused?.reason ?? '', /停了、删了或改过/);
  const currentGrant = h.handle.state.outboundGrants.require(grant.id);
  h.handle.state.outboundGrants.revoke(grant.id, currentGrant.version,
    { deviceId: 'device-mac', confirmedAt: h.clock.now().toISOString() });
  const revoked = submitRefusal(h.handle.state, { nodeId, runId: `line:${lineId}`, action: released });
  assert.match(revoked?.reason ?? '', /授权已停用或撤销/);
}

test('续火花：确认后照卡发给名单里的人；名单外照拦；每次记录主线身份和原确认', () => scheduleRoundTrip(false));
test('队友照卡发送从确认到设备回执都保持队友身份，不记成主线发送', () => scheduleRoundTrip(true));

test('照卡发送的内容规则：表情卡只认纯表情（含抖音表情码），固定内容只认原样；网站认子域名', () => {
  assert.equal(contentAllowed({ kind: 'emoji' }, '🔥'), true);
  assert.equal(contentAllowed({ kind: 'emoji' }, '👍🏻❤️'), true);
  assert.equal(contentAllowed({ kind: 'emoji' }, '[比心]'), true);
  assert.equal(contentAllowed({ kind: 'emoji' }, '🔥 在吗'), false);
  assert.equal(contentAllowed({ kind: 'emoji' }, '123'), false);
  assert.equal(contentAllowed({ kind: 'emoji' }, ''), false);
  assert.equal(contentAllowed({ kind: 'fixed', texts: ['早安'] }, '早安'), true);
  assert.equal(contentAllowed({ kind: 'fixed', texts: ['早安'] }, '早安呀'), false);
  assert.equal(siteAllowed('douyin.com', CHAT), true);
  assert.equal(siteAllowed('douyin.com', 'https://douyin.com.evil.cn/chat'), false);
  assert.equal(siteAllowed('douyin.com', 'not a url'), false);
});
