// Apple 日历和提醒事项的缓存（《优化清单》第 15 条，用户 11-06 定）：Mac 在线时定期把今天和接下来 7 天的日程、
// 未完成的提醒拉一份存下，Mac 不在线时首页和心跳读这一份，并标明是什么时候同步的。每台 Mac 每种一行，
// 新的一份整份换掉旧的（只是缓存，数据的正本在他的 iCloud 里）。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { CalendarEventSchema, ReminderItemSchema } from './api/device-ios.ts';
import { IdSchema, IsoTimeSchema } from './state-common.ts';

const STRICT = { additionalProperties: false };

export const CALENDAR_SNAPSHOT_SCOPES = ['events', 'reminders'] as const;
export const CalendarSnapshotScopeSchema = Type.Enum(CALENDAR_SNAPSHOT_SCOPES);
export type CalendarSnapshotScope = Static<typeof CalendarSnapshotScopeSchema>;

export const CalendarEventsSnapshotSchema = Type.Object({
  nodeId: IdSchema,
  scope: Type.Literal('events'),
  /** 拉的是哪一段（他所在时区的今天零点起 8 天）。 */
  windowFrom: IsoTimeSchema,
  windowTo: IsoTimeSchema,
  items: Type.Array(CalendarEventSchema),
  syncedAt: IsoTimeSchema,
}, STRICT);
export type CalendarEventsSnapshot = Static<typeof CalendarEventsSnapshotSchema>;

export const CalendarRemindersSnapshotSchema = Type.Object({
  nodeId: IdSchema,
  scope: Type.Literal('reminders'),
  windowFrom: IsoTimeSchema,
  windowTo: IsoTimeSchema,
  items: Type.Array(ReminderItemSchema),
  syncedAt: IsoTimeSchema,
}, STRICT);
export type CalendarRemindersSnapshot = Static<typeof CalendarRemindersSnapshotSchema>;

export type CalendarSnapshot = CalendarEventsSnapshot | CalendarRemindersSnapshot;

export type { CalendarEvent, ReminderItem } from './api/device-ios.ts';
