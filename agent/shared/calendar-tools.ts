import { Type } from 'typebox';
import { IOS_NOTES_MAX_CHARS, IOS_TITLE_MAX_CHARS } from './api/device-ios.ts';
import { IsoTimeSchema } from './api/common.ts';

const STRICT = { additionalProperties: false };
export const CALENDAR_READ_MAX_DAYS = 31;

const Title = Type.String({ minLength: 1, maxLength: IOS_TITLE_MAX_CHARS });
const Notes = Type.Optional(Type.Union([Type.String({ maxLength: IOS_NOTES_MAX_CHARS }), Type.Null()]));

export const CalendarReadParameters = Type.Object({
  from: IsoTimeSchema,
  to: IsoTimeSchema,
}, STRICT);

export const CalendarCreateParameters = Type.Object({
  title: Title,
  start: IsoTimeSchema,
  end: IsoTimeSchema,
  allDay: Type.Optional(Type.Boolean()),
  location: Type.Optional(Type.Union([Type.String({ maxLength: IOS_TITLE_MAX_CHARS }), Type.Null()])),
  notes: Notes,
}, STRICT);

export const ReminderCreateParameters = Type.Object({
  title: Title,
  due: Type.Optional(Type.Union([IsoTimeSchema, Type.Null()])),
  notes: Notes,
}, STRICT);

export const ReminderCompleteParameters = Type.Object({
  reminderId: Type.String({ minLength: 1, maxLength: 200 }),
}, STRICT);
