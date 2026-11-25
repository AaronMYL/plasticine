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

export type { CalendarEvent, ReminderItem } from './api/device-ios.ts';
