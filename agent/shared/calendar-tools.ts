// 给模型的日历和提醒工具（《优化清单》第 15 条）的参数：查日程、建日程、建提醒、完成提醒。都经设备动作交给他 Mac 上的
// 助手进程；Mac 不在线时查的读缓存，建的、完成的排队到它上线（24 小时内）。

import { Type, type Static } from 'typebox';
import { IOS_NOTES_MAX_CHARS, IOS_TITLE_MAX_CHARS } from './api/device-ios.ts';
import { IsoTimeSchema } from './api/common.ts';

const STRICT = { additionalProperties: false };
/** 一次最多查一个月：再长的翻到再查。 */
export const CALENDAR_READ_MAX_DAYS = 31;

const Title = Type.String({ minLength: 1, maxLength: IOS_TITLE_MAX_CHARS });
const Notes = Type.Optional(Type.Union([Type.String({ maxLength: IOS_NOTES_MAX_CHARS }), Type.Null()]));

export const CalendarReadParameters = Type.Object({
  from: IsoTimeSchema,
  to: IsoTimeSchema,
}, STRICT);
export type CalendarReadArgs = Static<typeof CalendarReadParameters>;

export const CalendarCreateParameters = Type.Object({
  title: Title,
  start: IsoTimeSchema,
  end: IsoTimeSchema,
  allDay: Type.Optional(Type.Boolean()),
  location: Type.Optional(Type.Union([Type.String({ maxLength: IOS_TITLE_MAX_CHARS }), Type.Null()])),
  notes: Notes,
}, STRICT);
export type CalendarCreateArgs = Static<typeof CalendarCreateParameters>;

export const ReminderCreateParameters = Type.Object({
  title: Title,
  /** 到点要响就给时间；只是某天要做给那天零点（他所在时区）；不给就是没有日期。 */
  due: Type.Optional(Type.Union([IsoTimeSchema, Type.Null()])),
  notes: Notes,
}, STRICT);
export type ReminderCreateArgs = Static<typeof ReminderCreateParameters>;

export const ReminderCompleteParameters = Type.Object({
  /** calendar_read 回的提醒编号。 */
  reminderId: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
export type ReminderCompleteArgs = Static<typeof ReminderCompleteParameters>;
