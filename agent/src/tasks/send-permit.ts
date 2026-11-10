// 照卡发送（《优化清单》第 3 条，11-07 他定）：以他名义、对象和内容固定的定时发送，建任务时他确认一次，以后每天照卡做。
// 发送那一下设备照样拦（page-operate.ts 判出是「发出去」就不点），定时线调 schedule_send 在这里核：
// - 这条线是一张在用的定时卡的线，卡以他名义对外，而且他确认过（哪张卡、哪次确认、哪台设备）；
// - 收件人在卡上的名单里，这一次还没给他发过；内容合卡上的规则（只发表情 / 只发那几条之一），页面上最近填的字也一样；
// - 被拦下的确实是「发出去」（不是付款、删除、改设置），而且就在卡上的网站。
// 都过了记一行放行（可审计：每次照卡发送都对得回卡和确认），回放行编号；模型带 submitAsk=<编号> 原样点一次，
// devices/page-submits.ts 再核一遍是这一下、只用一次。哪一条不过都不放行，原因回给模型：照旧先问他。

import type { ScheduleSend } from '../../shared/state.ts';
import { submitHoldForRun, tabTrace } from '../devices/index.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';
import { ensureScheduleGrant } from '../outbound/index.ts';
import { argsDigest } from '../system/index.ts';
import { contentAllowed, siteAllowed } from './schedule-text.ts';

export type PermitState = Pick<StateService, 'schedules' | 'scheduleSends' | 'nodeActions' | 'asks'
  | 'outboundGrants' | 'outboundLog' | 'lines' | 'mates' | 'transaction'>;

export interface PermitRequest {
  lineId: string;
  toolCallId: string;
  nodeId: string;
  tabId: string;
  version: string;
  recipient: string;
  content: string;
}

export class PermitRefused extends Error {
  constructor(reason: string) {
    super(`没有照卡放行：${reason}超出这张卡的照旧用 page_submit_ask 先问他。`);
    this.name = 'PermitRefused';
  }
}

/** 核过就记一行放行并返回它；不在卡的范围里抛 PermitRefused。同一次调用重跑认回同一行。 */
export function grantSend(state: PermitState, request: PermitRequest,
  scheduleOfLine: (lineId: string) => string | undefined): ScheduleSend {
  const line = state.lines.get(request.lineId);
  if (line === undefined) throw new PermitRefused('执行线不存在。');
  const actor = line.mateId ?? MAIN_LINE_ID;
  if (line.mateId != null && state.mates.require(line.mateId).disabledAt !== null) {
    throw new PermitRefused('负责这项定时工作的队友已停用。');
  }
  const existing = state.scheduleSends.forCall(request.lineId, request.toolCallId);
  if (existing !== undefined) {
    return existing;
  }
  const scheduleId = scheduleOfLine(request.lineId);
  const schedule = scheduleId === undefined ? undefined : state.schedules.get(scheduleId);
  if (schedule === undefined) {
    throw new PermitRefused('这条线不是定时线。');
  }
  if (schedule.status !== 'active') {
    throw new PermitRefused('这张定时卡没在用（停了、删了或还没确认）。');
  }
  const outward = schedule.outward;
  if (outward === null) {
    throw new PermitRefused('这张定时卡没有以他名义发出的范围。');
  }
  if (schedule.confirmAskId === null || schedule.confirmedByDeviceId === null) {
    throw new PermitRefused('这张定时卡没有他的确认。');
  }
  const confirm = state.asks.get(schedule.confirmAskId);
  if (confirm?.status !== 'answered' || confirm.answeredByDeviceId !== schedule.confirmedByDeviceId) {
    throw new PermitRefused('对不上他确认的那张卡。');
  }
  const recipient = request.recipient.trim();
  if (!outward.recipients.includes(recipient)) {
    throw new PermitRefused(`「${recipient}」不在卡上的名单里。`);
  }
  if (state.scheduleSends.forRun(schedule.id, schedule.lastRunAt).some((send) => send.recipient === recipient)) {
    throw new PermitRefused(`这一次已经给「${recipient}」发过了。`);
  }
  if (!contentAllowed(outward.content, request.content)) {
    throw new PermitRefused('要发的内容不合卡上定的（只发表情 / 只发那几条之一）。');
  }
  const runId = `line:${request.lineId}`;
  const hold = submitHoldForRun(state, runId, request.nodeId, request.tabId);
  if (hold === null || hold.version !== request.version) {
    throw new PermitRefused('这个标签这一版页面上还没有被设备拦下的发送：先点发送，被拦下后再照卡放行。');
  }
  if (hold.kind !== 'publish') {
    throw new PermitRefused('被拦下的不是「发出去」（是付款、删除、改设置或别的提交）。');
  }
  const trace = tabTrace(state, runId, request.nodeId, request.tabId);
  if (trace.url === null || !siteAllowed(outward.site, trace.url)) {
    throw new PermitRefused(`这一页不在卡上的网站（${outward.site}）。`);
  }
  if (trace.filled !== null && trace.filled.trim() !== request.content.trim()) {
    throw new PermitRefused('输入框里填的和要发的内容不一样。');
  }
  const grant = ensureScheduleGrant(state, schedule);
  if (grant === null || grant.actor !== actor || !grant.enabled || grant.revokedAt !== null) {
    throw new PermitRefused('这张定时卡的对外授权已停用或撤销。');
  }
  return state.transaction(() => {
    const log = state.outboundGrants.claim(grant, { actor, lineId: request.lineId,
      toolCallId: request.toolCallId, toolName: 'schedule_send', argsDigest: argsDigest({ ...request }) }, {
      channel: grant.channel, account: grant.account, category: grant.category, recipients: [recipient],
      content: request.content.trim(),
    });
    if (log === null) { throw new PermitRefused('这张定时卡的对外授权已经变化，请重新核对。'); }
    return state.scheduleSends.create({ scheduleId: schedule.id, confirmAskId: schedule.confirmAskId!,
    confirmedByDeviceId: schedule.confirmedByDeviceId!, lineId: request.lineId, runAt: schedule.lastRunAt,
    toolCallId: request.toolCallId, recipient, content: request.content.trim(), nodeId: request.nodeId,
    tabId: request.tabId, pageVersion: hold.version, n: hold.n, op: hold.op, pageUrl: trace.url! });
  });
}
