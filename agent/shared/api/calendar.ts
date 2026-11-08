// /v2/calendar/today：首页「现在」的「今天」一节（《优化清单》第 15 条，设计稿 Main / Phone-Now）。日程和提醒来自他 Mac
// 上的 Apple 日历和提醒事项（经 Mac 助手进程同步进缓存）。没给日历权限（Mac 没报 calendar_list 能力）就没有日程那一块，
// 提醒同理。打开首页时顺便叫一次同步（Mac 在线才拉），拉完推一条 calendar_changed，界面重读。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IsoTimeSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const CALENDAR_PATH = `${API_PREFIX}/calendar`;
export const CALENDAR_TODAY_PATH = `${CALENDAR_PATH}/today`;

/** 缓存过了这么久才在「今天」旁边写一行小字「几点同步」（11-06 定：超过 1 小时才出现）。 */
export const CALENDAR_STALE_MS = 60 * 60 * 1000;

const HexColor = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });

export const TodayEventSchema = Type.Object({
  kind: Type.Literal('event'),
  /** 日程编号 + 这一次的开始时间（重复日程每一次共用编号）。 */
  key: Type.String({ minLength: 1 }),
  title: Type.String(),
  start: IsoTimeSchema,
  end: IsoTimeSchema,
  allDay: Type.Boolean(),
  /** 日历颜色；没有就用中性色。 */
  color: OrNull(HexColor),
  calendar: Type.String(),
}, STRICT);
export type TodayEvent = Static<typeof TodayEventSchema>;

export const TodayReminderSchema = Type.Object({
  kind: Type.Literal('reminder'),
  key: Type.String({ minLength: 1 }),
  title: Type.String(),
  /** 今天到期（或已经过期没做）；hasTime 为假时只有日期。 */
  due: IsoTimeSchema,
  hasTime: Type.Boolean(),
  list: Type.String(),
}, STRICT);
export type TodayReminder = Static<typeof TodayReminderSchema>;

export const CalendarTodayQuerySchema = Type.Object({ tz: Type.Optional(TimeZoneSchema) }, STRICT);
export type CalendarTodayQuery = Static<typeof CalendarTodayQuerySchema>;

/** GET /v2/calendar/today */
export const CalendarTodayViewSchema = Type.Object({
  /** 有没有日程、提醒这两块：Mac 报了对应能力（给了完全访问权限）才有；没连过 Mac 两个都是假。 */
  calendar: Type.Boolean(),
  reminders: Type.Boolean(),
  /** 先日程（全天的在前，按开始时间），再提醒（按到期时间）。 */
  events: Type.Array(TodayEventSchema),
  reminderItems: Type.Array(TodayReminderSchema),
  /** 这份是什么时候从 Mac 拉的（两种里较早的那个）；还没同步过是 null。 */
  syncedAt: OrNull(IsoTimeSchema),
  /** Mac 现在在不在线（不在线时界面读的是缓存）。 */
  macOnline: Type.Boolean(),
}, STRICT);
export type CalendarTodayView = Static<typeof CalendarTodayViewSchema>;
