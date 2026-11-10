import type { NodeAction, Schedule } from '../../shared/state.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';

type ScheduleGrantState = Pick<StateService, 'outboundGrants' | 'asks'>;

/** 旧定时卡没有账号身份；这份授权只留给原任务的逐项核验入口。 */
export function ensureScheduleGrant(state: ScheduleGrantState, schedule: Schedule) {
  const existing = state.outboundGrants.bySchedule(schedule.id);
  if (existing !== undefined) { return existing; }
  const outward = schedule.outward;
  const ask = schedule.confirmAskId === null ? undefined : state.asks.get(schedule.confirmAskId);
  if (outward === null || schedule.confirmedAt === null || schedule.confirmedByDeviceId === null
    || ask?.status !== 'answered' || ask.answeredByDeviceId !== schedule.confirmedByDeviceId) { return null; }
  return state.outboundGrants.create({ actor: MAIN_LINE_ID, channel: outward.channel,
    account: `legacy-schedule:${schedule.id}`, recipientMode: 'list', recipients: outward.recipients,
    category: outward.content.kind, fixedTexts: outward.content.kind === 'fixed' ? outward.content.texts : null,
    scope: { kind: 'task', binding: { kind: 'schedule', id: schedule.id } }, expiresAt: null },
  { deviceId: schedule.confirmedByDeviceId, confirmedAt: schedule.confirmedAt },
  { askId: ask.id, legacyScheduleId: schedule.id });
}

/** 照卡放行只是准备；真正设备回执到了以后才记执行结果，不把放行冒充发送成功。 */
export function settleScheduleSend(state: Pick<StateService, 'scheduleSends' | 'outboundLog'>, row: NodeAction): void {
  if (row.status === 'queued' || row.status === 'sent' || row.kind !== 'tab_act'
    || typeof row.envelope !== 'object' || row.envelope === null) { return; }
  const action: unknown = Reflect.get(row.envelope, 'action');
  if (typeof action !== 'object' || action === null) { return; }
  const submitAsk: unknown = Reflect.get(action, 'submitAsk');
  if (typeof submitAsk !== 'string') { return; }
  const permit = state.scheduleSends.get(submitAsk);
  if (permit === undefined) { return; }
  const log = state.outboundLog.forCall(permit.lineId, permit.toolCallId);
  if (log === undefined) { return; }
  const status = row.status === 'executed' ? 'completed' : row.status === 'unknown' ? 'unknown' : 'failed';
  state.outboundLog.finish(log.id, { status, sourceRef: `device-action:${row.actionId}`,
    summary: row.reason ?? '设备返回执行完成；是否送达以发送页面的结果为准。' });
}
