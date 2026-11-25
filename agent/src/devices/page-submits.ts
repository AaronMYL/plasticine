import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  PageSubmitHoldSchema,
  SubmitKindSchema,
  type DeviceActionParams,
  type SubmitKind,
} from '../../shared/api/index.ts';
import type { OutboundLog } from '../../shared/outbound.ts';
import type { NodeAction, ScheduleSend } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import type { Refusal } from './limits.ts';
import { changesTab, tabIdOf } from './page-trace.ts';

const LINE_RUN_PREFIX = 'line:';

export const PAGE_SUBMIT_CONTEXT_KEY = 'pageSubmit';

export const PageSubmitContextSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  tabId: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  n: Type.Integer({ minimum: 1 }),
  op: Type.Enum(['click', 'enter']),
  kind: SubmitKindSchema,
  label: Type.String(),
  submitOption: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type PageSubmitContext = Static<typeof PageSubmitContextSchema>;

export interface SubmitHold {
  tabId: string;
  version: string;
  n: number;
  op: 'click' | 'enter';
  kind: SubmitKind;
  label: string;
  actionId: string;
}

type SubmitState = Pick<StateService, 'asks' | 'nodeActions' | 'schedules' | 'scheduleSends' | 'outboundGrants'
  | 'outboundLog'>;
type ActionsState = Pick<StateService, 'nodeActions'>;
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

export function submitHoldForRun(state: ActionsState, runId: string, nodeId: string, tabId: string)
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

export function changedSinceHold(state: ActionsState, runId: string, nodeId: string, hold: SubmitHold): boolean {
  const rows = state.nodeActions.forRunNode(runId, nodeId);
  const at = rows.findIndex((row) => row.actionId === hold.actionId);
  return rows.slice(at + 1).some((row) => tabIdOf(row) === hold.tabId && changesTab(row.kind)
    && row.status !== 'refused');
}

const TOUCHED = '拦下发送以后这个标签上又点过、填过、粘贴过或换过页：重新感知，再点一次发送，拦下后再放行。';

function touched(state: ActionsState, runId: string, nodeId: string, tabId: string): boolean {
  const hold = submitHoldForRun(state, runId, nodeId, tabId);
  return hold !== null && changedSinceHold(state, runId, nodeId, hold);
}

function refuse(reason: string): Refusal {
  return { layer: 'confirm', reason: `${reason}这一步没有发出。` };
}

function alreadyUsed(state: SubmitState, request: { runId: string; nodeId: string }, askId: string): boolean {
  const rows = state.nodeActions.forRunNode(request.runId, request.nodeId);
  return rows.some((row) => {
    const action = tabActOf(row);
    return action !== null && action.submitAsk === askId && row.status !== 'refused';
  });
}

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
  const sent = state.asks.get(action.submitAsk) === undefined ? state.outboundLog.get(action.submitAsk) : undefined;
  if (sent !== undefined) {
    return sendRefusal(state, request, action, sent);
  }
  const ask = state.asks.get(action.submitAsk);
  const context: unknown = ask?.context?.[PAGE_SUBMIT_CONTEXT_KEY];
  if (ask === undefined || !Value.Check(PageSubmitContextSchema, context)) {
    return refuse('没有这张问提交的卡：先用 page_submit_ask 问他。');
  }
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
  if (touched(state, runId, request.nodeId, action.tabId)) {
    return refuse(TOUCHED);
  }
  return null;
}

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
  const grant = state.outboundGrants.bySchedule(permit.scheduleId);
  if (grant !== undefined && (!grant.enabled || grant.revokedAt !== null)) {
    return refuse('这张定时卡的对外授权已停用或撤销，不能再发送。');
  }
  if (schedule?.status !== 'active' || schedule.confirmAskId !== permit.confirmAskId) {
    return refuse('这张定时卡已经停了、删了或改过（要他重新确认）：不能再照它发。');
  }
  if (alreadyUsed(state, { runId, nodeId: request.nodeId }, permit.id)) {
    return refuse('这个照卡放行已经用过一次；下一位要再照卡放行一次。');
  }
  if (touched(state, runId, request.nodeId, action.tabId)) {
    return refuse(TOUCHED);
  }
  return null;
}

const PAGE_SEND = 'page_send';
const SENDABLE: readonly string[] = ['publish', 'submit'];

function sendRefusal(state: SubmitState, request: { nodeId: string; runId?: string | null }, action: TabAct,
  log: OutboundLog): Refusal | null {
  if (action.act.op !== 'click' && action.act.op !== 'enter') {
    return refuse('发送放行只用在点发送或回车。');
  }
  const runId = request.runId?.startsWith(LINE_RUN_PREFIX) === true ? request.runId : null;
  if (runId === null || runId !== `${LINE_RUN_PREFIX}${log.lineId}` || log.toolName !== PAGE_SEND) {
    return refuse('这个发送放行不是这条线的。');
  }
  if (log.status !== 'pending') {
    return refuse('这次发送已经有结果了，不再放第二次。');
  }
  const hold = submitHoldForRun(state, runId, request.nodeId, action.tabId);
  if (hold === null || hold.version !== action.version || hold.n !== action.act.n || hold.op !== action.act.op) {
    return refuse('放行的是另一个标签、另一版页面或另一个元素：页面变了就重新感知、重新点发送。');
  }
  if (!SENDABLE.includes(hold.kind)) {
    return refuse('拦下的是付款、删除或改设置，不能按发送放行。');
  }
  if (alreadyUsed(state, { runId, nodeId: request.nodeId }, log.id)) {
    return refuse('这次发送已经放行过一次。');
  }
  if (changedSinceHold(state, runId, request.nodeId, hold)) {
    return refuse(TOUCHED);
  }
  return null;
}
