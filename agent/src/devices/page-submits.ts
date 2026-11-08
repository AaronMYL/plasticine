// 「问这一页 → 操作整页」的提交硬线（2026-11-04 第 3 批，他定：看、点、翻页、填表直接做，提交前问他）。
// 注入脚本（client/src/mac/page-operate.ts）按页面上真实的元素判「这一下是不是提交」，没放行就不点，回执报
// submit_needs_you 和提交的种类、按钮上的字。这里管放行：
// - submitHold：这项任务在这个标签上最近一次被拦下的提交（种类、按钮的字、编号、那次感知的 version），由设备回执来，
//   不由模型说——要你定卡（page_submit_ask）照它写「提交会发生什么」。
// - submitRefusal：tab_act 带了 submitAsk 时核对那张卡：他答了、选的是卡上标成「提交」的那一项、问的就是这个标签这一版
//   页面上的这个元素、是这项任务的卡、而且只放行一次。核对不过就不发，原因回给脑。

import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  PageSubmitHoldSchema,
  SubmitKindSchema,
  type DeviceActionParams,
  type SubmitKind,
} from '../../shared/api/index.ts';
import type { NodeAction, ScheduleSend } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import type { Refusal } from './limits.ts';

/** 新内核的线发的设备动作，run_id 是 line:<线>（lines/legacy.ts）。 */
const LINE_RUN_PREFIX = 'line:';

/** 要你定卡 context 里放这一份的键。 */
export const PAGE_SUBMIT_CONTEXT_KEY = 'pageSubmit';

export const PageSubmitContextSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  tabId: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  n: Type.Integer({ minimum: 1 }),
  op: Type.Enum(['click', 'enter']),
  kind: SubmitKindSchema,
  label: Type.String(),
  /** 卡上哪一项是「提交」：只有选了它才放行。 */
  submitOption: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type PageSubmitContext = Static<typeof PageSubmitContextSchema>;

/** 被拦下的那一次提交：设备回执里的种类和按钮上的字，加上那一下的编号和页面版本。 */
export interface SubmitHold {
  tabId: string;
  version: string;
  n: number;
  op: 'click' | 'enter';
  kind: SubmitKind;
  label: string;
  actionId: string;
}

type SubmitState = Pick<StateService, 'asks' | 'nodeActions' | 'schedules' | 'scheduleSends'>;
type TabAct = Extract<DeviceActionParams, { kind: 'tab_act' }>;

function tabActOf(row: NodeAction): TabAct | null {
  const envelope = row.envelope;
  if (typeof envelope !== 'object' || envelope === null) {
    return null;
  }
  const action: unknown = Reflect.get(envelope, 'action');
  if (typeof action !== 'object' || action === null || Reflect.get(action, 'kind') !== 'tab_act') {
    return null;
  }
  return action as TabAct;
}

function heldBySubmit(row: NodeAction): boolean {
  return row.kind === 'tab_act' && typeof row.result === 'object' && row.result !== null
    && Reflect.get(row.result, 'errorCode') === 'submit_needs_you';
}

/** 新内核：这条线（run_id = line:<线>）在这个标签上最近一次被拦下的提交；没有是 null。 */
export function submitHoldForRun(state: SubmitState, runId: string, nodeId: string, tabId: string)
  : SubmitHold | null {
  return latestHold(state.nodeActions.forRunNode(runId, nodeId), tabId);
}

function latestHold(actions: NodeAction[], tabId: string): SubmitHold | null {
  const rows = actions.filter(heldBySubmit);
  for (const row of rows.reverse()) {
    const action = tabActOf(row);
    if (action === null || action.tabId !== tabId || (action.act.op !== 'click' && action.act.op !== 'enter')
      || !Value.Check(PageSubmitHoldSchema, row.result)) {
      continue;
    }
    return { tabId, version: action.version, n: action.act.n, op: action.act.op, kind: row.result.submit.kind,
      label: row.result.submit.label, actionId: row.actionId };
  }
  return null;
}

/** 这条线在这个标签上最近看到的页面地址、最近一次填进去的字（照卡发送核网站和内容用，tasks/send-permit.ts）。 */
export interface TabTrace {
  url: string | null;
  filled: string | null;
}

function tabIdOf(row: NodeAction): string | null {
  const envelope = row.envelope;
  if (typeof envelope !== 'object' || envelope === null) {
    return null;
  }
  const action: unknown = Reflect.get(envelope, 'action');
  const tabId: unknown = typeof action === 'object' && action !== null ? Reflect.get(action, 'tabId') : null;
  return typeof tabId === 'string' ? tabId : null;
}

function urlOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }
  for (const key of ['after', 'page']) {
    const part: unknown = Reflect.get(result, key);
    const url: unknown = typeof part === 'object' && part !== null ? Reflect.get(part, 'url') : null;
    if (typeof url === 'string' && url !== '') {
      return url;
    }
  }
  const url: unknown = Reflect.get(result, 'url');
  return typeof url === 'string' && url !== '' ? url : null;
}

export function tabTrace(state: SubmitState, runId: string, nodeId: string, tabId: string): TabTrace {
  let url: string | null = null;
  let filled: string | null = null;
  for (const row of state.nodeActions.forRunNode(runId, nodeId)) {
    if (tabIdOf(row) !== tabId || row.status !== 'executed') {
      continue;
    }
    url = urlOf(row.result) ?? url;
    const action = tabActOf(row);
    if (action !== null && action.act.op === 'fill') {
      filled = action.act.value;
    }
  }
  return { url, filled };
}

function refuse(reason: string): Refusal {
  return { layer: 'confirm', reason: `${reason}这一步没有发出。` };
}

/** 同一张卡已经放行过一次提交（发出去了、在路上或结果不明）：不再放第二次。 */
function alreadyUsed(state: SubmitState, request: { runId: string; nodeId: string }, askId: string): boolean {
  const rows = state.nodeActions.forRunNode(request.runId, request.nodeId);
  return rows.some((row) => {
    const action = tabActOf(row);
    return action !== null && action.submitAsk === askId && row.status !== 'refused';
  });
}

/**
 * tab_act 带 submitAsk 时的核对；不带（平时）或不是 tab_act 是 null。核对不过回拒绝（不发），原因说清下一步。
 */
export function submitRefusal(state: SubmitState, request: { nodeId: string; runId?: string | null;
  action: DeviceActionParams }): Refusal | null {
  const action = request.action;
  if (action.kind !== 'tab_act' || action.submitAsk === null) {
    return null;
  }
  if (action.act.op !== 'click' && action.act.op !== 'enter') {
    return refuse('submitAsk 只放行点提交按钮或在框里回车；填、选、翻页不用带。');
  }
  const permit = state.asks.get(action.submitAsk) === undefined ? state.scheduleSends.get(action.submitAsk) : undefined;
  if (permit !== undefined) {
    return permitRefusal(state, request, action, permit);
  }
  const ask = state.asks.get(action.submitAsk);
  const context: unknown = ask?.context?.[PAGE_SUBMIT_CONTEXT_KEY];
  if (ask === undefined || !Value.Check(PageSubmitContextSchema, context)) {
    return refuse('没有这张问提交的卡：先用 page_submit_ask 问他。');
  }
  // 卡按线问（ask.runId = line:<线>），核对是不是这条线问的。
  const runId = request.runId?.startsWith(LINE_RUN_PREFIX) === true ? request.runId : null;
  if (runId === null || ask.runId !== runId) {
    return refuse('这张卡不是这条线问的。');
  }
  if (ask.status !== 'answered' || ask.answer === null) {
    return refuse('他还没在卡上定，先等他。');
  }
  if (ask.answer.optionId !== context.submitOption) {
    return refuse(`他没有选提交（选的是「${ask.answer.label}」）：照他选的做，不提交。`);
  }
  if (context.nodeId !== request.nodeId || context.tabId !== action.tabId || context.version !== action.version
    || context.n !== action.act.n) {
    return refuse('卡上问的是另一个标签、另一版页面或另一个元素：页面变了就重新感知，再问一次。');
  }
  if (context.op !== action.act.op) {
    return refuse('卡上确认的是另一种动作类型：点击与回车不能互换。');
  }
  if (alreadyUsed(state, { runId, nodeId: request.nodeId }, ask.id)) {
    return refuse('这张卡已经放行过一次提交（一张卡只放一次）；要再提交得再问他。');
  }
  return null;
}

/**
 * 照卡发送（《优化清单》第 3 条，11-07 他定）：submitAsk 带的是一次照卡放行（schedule_sends 的一行，tasks/send-permit.ts
 * 核过对谁、发什么、在哪个网站，都在他确认过的定时卡范围里）。这里再核：是这条线放行的、就是放行的那个标签那一版页面的
 * 那一下、那张卡还在用而且还是他确认的那一次、这个放行只用一次。范围外的照拦。
 */
function permitRefusal(state: SubmitState, request: { nodeId: string; runId?: string | null },
  action: TabAct, permit: ScheduleSend): Refusal | null {
  if (action.act.op !== 'click' && action.act.op !== 'enter') {
    return refuse('照卡放行只用在点发送或回车；填、选、翻页不用带。');
  }
  const runId = request.runId?.startsWith(LINE_RUN_PREFIX) === true ? request.runId : null;
  if (runId === null || runId !== `${LINE_RUN_PREFIX}${permit.lineId}`) {
    return refuse('这个照卡放行不是这条线的。');
  }
  if (permit.nodeId !== request.nodeId || permit.tabId !== action.tabId || permit.pageVersion !== action.version
    || permit.n !== action.act.n || permit.op !== action.act.op) {
    return refuse('放行的是另一个标签、另一版页面或另一个元素：页面变了就重新感知，再照卡放行一次。');
  }
  const schedule = state.schedules.get(permit.scheduleId);
  if (schedule?.status !== 'active' || schedule.confirmAskId !== permit.confirmAskId) {
    return refuse('这张定时卡已经停了、删了或改过（要他重新确认）：不能再照它发。');
  }
  if (alreadyUsed(state, { runId, nodeId: request.nodeId }, permit.id)) {
    return refuse('这个照卡放行已经用过一次；下一位要再照卡放行一次。');
  }
  return null;
}
