import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const CALENDAR_PATH = `${API_PREFIX}/calendar`;
export const CALENDAR_TODAY_PATH = `${CALENDAR_PATH}/today`;

export const CALENDAR_STALE_MS = 60 * 60 * 1000;

const HexColor = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });

export const TodayEventSchema = Type.Object({
  kind: Type.Literal('event'),
  key: Type.String({ minLength: 1 }),
  title: Type.String(),
  start: IsoTimeSchema,
  end: IsoTimeSchema,
  allDay: Type.Boolean(),
  color: OrNull(HexColor),
  calendar: Type.String(),
}, STRICT);
export type TodayEvent = Static<typeof TodayEventSchema>;

export const TodayReminderSchema = Type.Object({
  kind: Type.Literal('reminder'),
  key: Type.String({ minLength: 1 }),
  title: Type.String(),
  due: IsoTimeSchema,
  hasTime: Type.Boolean(),
  list: Type.String(),
}, STRICT);
export type TodayReminder = Static<typeof TodayReminderSchema>;

export const CalendarTodayQuerySchema = Type.Object({ tz: Type.Optional(TimeZoneSchema) }, STRICT);
export type CalendarTodayQuery = Static<typeof CalendarTodayQuerySchema>;

/** GET /v2/calendar/today */
export const CalendarTodayViewSchema = Type.Object({
  calendar: Type.Boolean(),
  reminders: Type.Boolean(),
  events: Type.Array(TodayEventSchema),
  reminderItems: Type.Array(TodayReminderSchema),
  syncedAt: OrNull(IsoTimeSchema),
  macOnline: Type.Boolean(),
}, STRICT);
export type CalendarTodayView = Static<typeof CalendarTodayViewSchema>;
