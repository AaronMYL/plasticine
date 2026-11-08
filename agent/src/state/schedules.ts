// 定时线和照卡发送的存取（《优化清单》第 3 条）：业务判断（什么时候到点、范围核对、谁能确认）在 tasks/，这里只读写。
// 删只标记（removed），照卡发送的记录只增不改。

import {
  ScheduleInputSchema,
  SchedulePatchSchema,
  ScheduleSchema,
  ScheduleSendInputSchema,
  ScheduleSendSchema,
  type Schedule,
  type ScheduleInput,
  type SchedulePatch,
  type ScheduleSend,
  type ScheduleSendInput,
  type ScheduleStatus,
} from '../../shared/state.ts';
import { Type } from 'typebox';
import { RECORD_META_COLUMNS, type ColumnMap } from './codec.ts';
import { allPages, ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const SCHEDULE_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  title: 'text',
  goal: 'text',
  cadence: 'json',
  projectId: 'text',
  report: 'text',
  place: 'text',
  outward: 'json',
  replacesId: 'text',
  draftedBy: 'text',
  status: 'text',
  lineId: 'text',
  nextAt: 'text',
  lastRunAt: 'text',
  lastOutcome: 'text',
  lastNote: 'text',
  confirmAskId: 'text',
  confirmedAt: 'text',
  confirmedByDeviceId: 'text',
  removedAt: 'text',
};

const SCHEDULE_SPEC: StoreSpec<typeof ScheduleSchema, typeof ScheduleInputSchema, typeof SchedulePatchSchema> = {
  table: 'schedules',
  schema: ScheduleSchema,
  input: ScheduleInputSchema,
  patch: SchedulePatchSchema,
  columns: SCHEDULE_COLUMNS,
  defaults: { status: 'draft', lineId: null, nextAt: null, lastRunAt: null, lastOutcome: null, lastNote: null,
    confirmAskId: null, confirmedAt: null, confirmedByDeviceId: null, removedAt: null },
};

const SEND_COLUMNS: ColumnMap = {
  ...RECORD_META_COLUMNS,
  scheduleId: 'text',
  confirmAskId: 'text',
  confirmedByDeviceId: 'text',
  lineId: 'text',
  runAt: 'text',
  toolCallId: 'text',
  recipient: 'text',
  content: 'text',
  nodeId: 'text',
  tabId: 'text',
  pageVersion: 'text',
  n: 'integer',
  op: 'text',
  pageUrl: 'text',
};

// 照卡发送只增不改：patch 是空的。
const NoPatch = Type.Object({}, { additionalProperties: false });

const SEND_SPEC: StoreSpec<typeof ScheduleSendSchema, typeof ScheduleSendInputSchema, typeof NoPatch> = {
  table: 'schedule_sends',
  schema: ScheduleSendSchema,
  input: ScheduleSendInputSchema,
  patch: NoPatch,
  columns: SEND_COLUMNS,
  defaults: {},
};

/** 列表里看得到的（起草等确认、在跑、停了的）；没确认的、换掉的、删了的不列。 */
const LISTED: readonly ScheduleStatus[] = ['draft', 'active', 'paused'];

export function createScheduleStores(context: StoreContext) {
  const schedules = new ObjectStore(context, SCHEDULE_SPEC);
  const sends = new ObjectStore(context, SEND_SPEC);
  const inList = LISTED.map((status) => `'${status}'`).join(', ');
  return {
    schedules: {
      create: (input: ScheduleInput): Schedule => schedules.create(input),
      get: schedules.get.bind(schedules),
      require: schedules.require.bind(schedules),
      update: (id: string, version: number, patch: SchedulePatch): Schedule => schedules.update(id, version, patch),
      /** 同一次起草（同一条线的同一次调用）认回同一张。 */
      byDraft: (draftedBy: string): Schedule | undefined =>
        schedules.select('drafted_by = $drafted', { drafted: draftedBy }, { limit: 1 })[0],
      byLine: (lineId: string): Schedule | undefined =>
        schedules.select('line_id = $line', { line: lineId }, { limit: 1 }, 'created_at DESC, id DESC')[0],
      byAsk: (askId: string): Schedule | undefined =>
        schedules.select('confirm_ask_id = $ask', { ask: askId }, { limit: 1 })[0],
      /** 任务栏目「定时」里列的：起草等确认、在跑、停了的，旧的在前。 */
      listed: (): Schedule[] => allPages((page) => schedules.select(`status IN (${inList})`, {}, page)),
      /** 到点了的（在跑、下次时间不晚于 at）。 */
      due: (at: string): Schedule[] => allPages((page) =>
        schedules.select("status = 'active' AND next_at IS NOT NULL AND next_at <= $at", { at }, page,
          'next_at, id')),
    },
    scheduleSends: {
      create: (input: ScheduleSendInput): ScheduleSend => sends.create(input),
      get: sends.get.bind(sends),
      forCall: (lineId: string, toolCallId: string): ScheduleSend | undefined =>
        sends.select('line_id = $line AND tool_call_id = $call', { line: lineId, call: toolCallId }, { limit: 1 })[0],
      /** 这张卡这一次到点放行过的（同一位不发第二次）。 */
      forRun: (scheduleId: string, runAt: string | null): ScheduleSend[] => allPages((page) => sends.select(
        runAt === null ? 'schedule_id = $schedule AND run_at IS NULL' : 'schedule_id = $schedule AND run_at = $run',
        runAt === null ? { schedule: scheduleId } : { schedule: scheduleId, run: runAt }, page)),
      forSchedule: (scheduleId: string): ScheduleSend[] => allPages((page) =>
        sends.select('schedule_id = $schedule', { schedule: scheduleId }, page)),
    },
  };
}

export type ScheduleStores = ReturnType<typeof createScheduleStores>;
