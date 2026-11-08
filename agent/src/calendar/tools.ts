// 给模型的日历和提醒工具（《优化清单》第 15 条，11-06 定）：查日程、建日程、建提醒、完成提醒，都经设备动作交给他 Mac 上
// 的助手进程（Apple 日历和提醒事项，iCloud 和 iPhone 同一份）。替他建、替他勾掉是「替他动手」，不出卡。
// Mac 不在线：查的读缓存并说明是几点同步的；建的、完成的排队到 Mac 上线（devices/ 的 OFFLINE_QUEUE_KINDS，24 小时内），
// 告诉他还没做。写完按回执里重新读出来的那一份核对（proveDeviceAction），再叫一次同步让首页跟上。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { DEVICE_RESULT_SCHEMAS, type DeviceActionParams } from '../../shared/api/index.ts';
import {
  CALENDAR_READ_MAX_DAYS, CalendarCreateParameters, CalendarReadParameters, ReminderCompleteParameters,
  ReminderCreateParameters,
} from '../../shared/calendar-tools.ts';
import type { CalendarEvent, DeviceActionKind, DeviceNode, ReminderItem } from '../../shared/state.ts';
import { nodeOnline, proveDeviceAction, type ActionOutcome } from '../devices/index.ts';
import { checkedArgs, type KernelTool, type LineScope } from '../lines/index.ts';
import type { CalendarDevicePort, CalendarSync, CalendarSyncState } from './sync.ts';

const DAY_MS = 24 * 60 * 60_000;

export interface CalendarToolParts {
  state: CalendarSyncState;
  devices: CalendarDevicePort;
  sync: CalendarSync;
  now: () => Date;
  zone: () => string;
}

type Reply = { content: { type: 'text'; text: string }[]; details: Record<string, never> };

function reply(value: unknown): Reply {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
}

function stamp(iso: string, zone: string): string {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: zone, month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function overlaps(item: { start: string; end: string }, from: number, to: number): boolean {
  return Date.parse(item.start) < to && Date.parse(item.end) > from;
}

function dueBy(item: ReminderItem, to: number): boolean {
  return !item.completed && (item.due === null || Date.parse(item.due) < to);
}

const NO_MAC = '还没有连上会读日历的 Mac：要他在 Mac 上打开 Plasticine，并在「系统设置 → 隐私与安全性」里给日历和提醒事项'
  + '完全访问权限。这一步没有做。';

class CalendarTools {
  readonly #parts: CalendarToolParts;

  constructor(parts: CalendarToolParts) {
    this.#parts = parts;
  }

  #mac(kind: DeviceActionKind): DeviceNode {
    const mac = this.#parts.sync.mac();
    if (mac === null) {
      throw new Error(NO_MAC);
    }
    if (!mac.capabilities.includes(kind)) {
      const what = kind.startsWith('calendar') ? '日历' : '提醒事项';
      throw new Error(`「${mac.name}」没有${what}的完全访问权限：请他在「系统设置 → 隐私与安全性 → ${what}」里允许 `
        + 'Plasticine，或在 Plasticine 的「设置 · 系统」里点去授权。这一步没有做。');
    }
    return mac;
  }

  async #perform(scope: LineScope, toolCallId: string, mac: DeviceNode, action: DeviceActionParams,
    purpose: string, signal?: AbortSignal): Promise<ActionOutcome> {
    return this.#parts.devices.perform({ actionId: `calendar:${scope.lineId}:${toolCallId}`, nodeId: mac.id,
      action, origin: 'brain', taskId: null, runId: `line:${scope.lineId}`, purpose,
      ...(signal === undefined ? {} : { signal }) });
  }

  async read(scope: LineScope, toolCallId: string, raw: unknown, signal?: AbortSignal): Promise<Reply> {
    const args = checkedArgs(CalendarReadParameters, raw, 'calendar_read');
    const from = Date.parse(args.from);
    const to = Date.parse(args.to);
    if (!(from < to) || to - from > CALENDAR_READ_MAX_DAYS * DAY_MS) {
      throw new Error(`from 要早于 to，一次最多查 ${CALENDAR_READ_MAX_DAYS} 天。这一步没有做。`);
    }
    const mac = this.#parts.sync.mac();
    if (mac === null) {
      throw new Error(NO_MAC);
    }
    if (nodeOnline(mac, this.#parts.now())) {
      return reply(await this.#readLive(scope, toolCallId, mac, args, signal));
    }
    return reply(this.#readCache(mac, from, to));
  }

  async #readLive(scope: LineScope, toolCallId: string, mac: DeviceNode, args: { from: string; to: string },
    signal?: AbortSignal): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = { source: `「${mac.name}」上的 Apple 日历和提醒事项（现在读的）` };
    if (mac.capabilities.includes('calendar_list')) {
      const outcome = await this.#perform(scope, toolCallId, mac, { kind: 'calendar_list', from: args.from,
        to: args.to }, '查他要的那几天的日程', signal);
      result['events'] = this.#executed(outcome, DEVICE_RESULT_SCHEMAS.calendar_list).events;
    }
    if (mac.capabilities.includes('reminder_list')) {
      const outcome = await this.#perform(scope, `${toolCallId}:reminders`, mac,
        { kind: 'reminder_list', includeCompleted: false }, '查没做完的提醒事项', signal);
      const to = Date.parse(args.to);
      result['reminders'] = this.#executed(outcome, DEVICE_RESULT_SCHEMAS.reminder_list).reminders
        .filter((item) => dueBy(item, to));
    }
    return result;
  }

  #readCache(mac: DeviceNode, from: number, to: number): Record<string, unknown> {
    const { state, zone } = this.#parts;
    const events = state.calendarSnapshots.latestEvents();
    const reminders = state.calendarSnapshots.latestReminders();
    if (events === undefined && reminders === undefined) {
      throw new Error(`「${mac.name}」现在不在线，也还没有同步过日历：等它上线再查。这一步没有做。`);
    }
    const result: Record<string, unknown> = { source: `「${mac.name}」不在线，下面是缓存` };
    if (events !== undefined) {
      const covered = Date.parse(events.windowFrom) <= from && Date.parse(events.windowTo) >= to;
      result['eventsSyncedAt'] = stamp(events.syncedAt, zone());
      result['eventsCover'] = `${stamp(events.windowFrom, zone())} – ${stamp(events.windowTo, zone())}`
        + (covered ? '' : '（没有完全盖住要查的那几天，盖不到的部分不知道）');
      result['events'] = events.items.filter((item: CalendarEvent) => overlaps(item, from, to));
    }
    if (reminders !== undefined) {
      result['remindersSyncedAt'] = stamp(reminders.syncedAt, zone());
      result['reminders'] = reminders.items.filter((item) => dueBy(item, to));
    }
    return result;
  }

  #executed<T extends TSchema>(outcome: ActionOutcome, schema: T): Static<T> {
    if (outcome.status !== 'executed') {
      throw new Error(outcome.reason ?? '这一步没有做成。');
    }
    if (!Value.Check(schema, outcome.result)) {
      throw new Error('Mac 的回执形状不对，说不清读没读到；先别据此回答。');
    }
    return outcome.result;
  }

  async write(scope: LineScope, toolCallId: string, action: DeviceActionParams, purpose: string,
    signal?: AbortSignal): Promise<Reply> {
    const mac = this.#mac(action.kind);
    const outcome = await this.#perform(scope, toolCallId, mac, action, purpose, signal);
    if (outcome.status === 'queued' && outcome.detached === true) {
      return reply({ status: 'queued', note: outcome.reason });
    }
    if (outcome.status === 'dry_run') {
      return reply({ status: 'dry_run', note: outcome.reason });
    }
    if (outcome.status !== 'executed') {
      throw new Error(outcome.reason ?? '这一步没有做成。');
    }
    const proof = proveDeviceAction(action, outcome.result);
    if (!proof.proven) {
      throw new Error(`Mac 说做了，但${proof.detail}：回执不能证明做对了，先用 calendar_read 读回核对。`);
    }
    this.#parts.sync.kick(true);
    return reply({ status: 'done', result: outcome.result, proof });
  }
}

/** 查日程、建日程、建提醒、完成提醒。 */
export function calendarTools(parts: CalendarToolParts): KernelTool[] {
  const tools = new CalendarTools(parts);
  const text = (args: Record<string, unknown>, key: string): string => (typeof args[key] === 'string'
    ? String(args[key]) : '');
  const kernel = (name: string, say: (args: Record<string, unknown>) => string,
    make: (scope: LineScope) => AgentTool): KernelTool => ({ name, say, hardLine: () => null, create: make });
  return [
    kernel('calendar_read', () => '看他的日程和提醒', (scope) => ({
      name: 'calendar_read',
      label: '查日程',
      description: 'Reads his Apple Calendar events between from and to (ISO, at most 31 days) and his '
        + 'unfinished Reminders due before to (or with no date), from his Mac (iCloud, same data as his iPhone). '
        + 'When the Mac is offline it returns the last synced copy and says when it was synced; say so when you '
        + 'answer. Reminder ids are what reminder_complete takes.',
      parameters: CalendarReadParameters,
      execute: (toolCallId, raw, signal) => tools.read(scope, toolCallId, raw, signal),
    })),
    kernel('calendar_create', (args) => `建日程：${text(args, 'title')}`, (scope) => ({
      name: 'calendar_create',
      label: '建日程',
      description: 'Adds one event to his Apple Calendar on his Mac (shows up on his iPhone). Give start and end '
        + 'with his time zone offset; allDay events start at local midnight. Doing it for him is fine, no need '
        + 'to ask; when the Mac is offline it is queued until the Mac is back (24 h) and has not happened yet: '
        + 'tell him that.',
      parameters: CalendarCreateParameters,
      async execute(toolCallId, raw, signal) {
        const args = checkedArgs(CalendarCreateParameters, raw, 'calendar_create');
        return tools.write(scope, toolCallId, { kind: 'calendar_create', title: args.title, start: args.start,
          end: args.end, allDay: args.allDay ?? false, location: args.location ?? null, notes: args.notes ?? null },
        `替他在日历上建「${args.title}」`, signal);
      },
    })),
    kernel('reminder_create', (args) => `建提醒：${text(args, 'title')}`, (scope) => ({
      name: 'reminder_create',
      label: '建提醒',
      description: 'Adds one reminder to his Apple Reminders on his Mac. With a due time it alarms on his iPhone '
        + 'and Mac at that time; a date-only due is local midnight of that day. When the Mac is offline it is '
        + 'queued until the Mac is back (24 h): tell him it has not happened yet.',
      parameters: ReminderCreateParameters,
      async execute(toolCallId, raw, signal) {
        const args = checkedArgs(ReminderCreateParameters, raw, 'reminder_create');
        return tools.write(scope, toolCallId, { kind: 'reminder_create', title: args.title, due: args.due ?? null,
          notes: args.notes ?? null }, `替他建提醒「${args.title}」`, signal);
      },
    })),
    kernel('reminder_complete', () => '把一条提醒标成完成', (scope) => ({
      name: 'reminder_complete',
      label: '完成提醒',
      description: 'Marks one of his reminders done (the id from calendar_read). Only when he said it is done.',
      parameters: ReminderCompleteParameters,
      async execute(toolCallId, raw, signal) {
        const args = checkedArgs(ReminderCompleteParameters, raw, 'reminder_complete');
        return tools.write(scope, toolCallId, { kind: 'reminder_complete', reminderId: args.reminderId },
          '他说做完了，替他把提醒勾掉', signal);
      },
    })),
  ];
}
