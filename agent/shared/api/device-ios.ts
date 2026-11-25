import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const IOS_TITLE_MAX_CHARS = 200;
export const IOS_NOTES_MAX_CHARS = 2_000;
export const IOS_SHORTCUT_INPUT_MAX_CHARS = 4_000;

const Title = Type.String({ minLength: 1, maxLength: IOS_TITLE_MAX_CHARS });
const Notes = OrNull(Type.String({ maxLength: IOS_NOTES_MAX_CHARS }));
const ItemId = Type.String({ minLength: 1, maxLength: 200 });

export const IOS_ACTION_PARAM_SCHEMAS = [
  Type.Object({ kind: Type.Literal('calendar_list'), from: IsoTimeSchema, to: IsoTimeSchema }, STRICT),
  Type.Object({ kind: Type.Literal('calendar_create'), title: Title, start: IsoTimeSchema, end: IsoTimeSchema,
    allDay: Type.Boolean(), location: OrNull(Type.String({ maxLength: IOS_TITLE_MAX_CHARS })), notes: Notes }, STRICT),
  Type.Object({ kind: Type.Literal('reminder_list'), includeCompleted: Type.Boolean() }, STRICT),
  Type.Object({ kind: Type.Literal('reminder_create'), title: Title, due: OrNull(IsoTimeSchema), notes: Notes },
    STRICT),
  Type.Object({ kind: Type.Literal('reminder_complete'), reminderId: ItemId }, STRICT),
  Type.Object({ kind: Type.Literal('shortcut_run'), name: Type.String({ minLength: 1, maxLength: 200 }),
    input: OrNull(Type.String({ maxLength: IOS_SHORTCUT_INPUT_MAX_CHARS })) }, STRICT),
] as const;

const HexColor = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });
export const CalendarInfoSchema = Type.Object({ id: Type.String(), title: Type.String(), color: HexColor,
  source: Type.String(), writable: Type.Boolean() }, STRICT);
export const CalendarEventSchema = Type.Object({ id: Type.String(), title: Type.String(),
  start: IsoTimeSchema, end: IsoTimeSchema, allDay: Type.Boolean(), location: OrNull(Type.String()),
  notes: OrNull(Type.String()), calendar: Type.String(), calendarId: Type.Optional(Type.String()),
  color: Type.Optional(HexColor), withOthers: Type.Optional(Type.Boolean()) }, STRICT);
export type CalendarEvent = Static<typeof CalendarEventSchema>;
export const ReminderItemSchema = Type.Object({ id: Type.String(), title: Type.String(),
  due: OrNull(IsoTimeSchema), completed: Type.Boolean(), notes: OrNull(Type.String()), list: Type.String(),
  dueHasTime: Type.Optional(Type.Boolean()), listId: Type.Optional(Type.String()), color: Type.Optional(HexColor) },
STRICT);
export type ReminderItem = Static<typeof ReminderItemSchema>;

const EventReadBack = Type.Object({ title: Type.String(), start: IsoTimeSchema, end: IsoTimeSchema,
  allDay: Type.Boolean() }, STRICT);
const ReminderReadBack = Type.Object({ title: Type.String(), due: OrNull(IsoTimeSchema),
  completed: Type.Boolean() }, STRICT);

export const IOS_RESULT_SCHEMAS = {
  calendar_list: Type.Object({ events: Type.Array(CalendarEventSchema), truncated: Type.Boolean() }, STRICT),
  calendar_create: Type.Object({ eventId: Type.String({ minLength: 1 }), readBack: EventReadBack }, STRICT),
  reminder_list: Type.Object({ reminders: Type.Array(ReminderItemSchema), truncated: Type.Boolean(),
    lists: Type.Optional(Type.Array(CalendarInfoSchema)) }, STRICT),
  reminder_create: Type.Object({ reminderId: Type.String({ minLength: 1 }), readBack: ReminderReadBack }, STRICT),
  reminder_complete: Type.Object({ readBack: Type.Object({ title: Type.String(), completed: Type.Boolean() },
    STRICT) }, STRICT),
  shortcut_run: Type.Object({ outcome: Type.Enum(['success', 'opened']), output: OrNull(Type.String()) }, STRICT),
} as const;

export const IOS_KIND_LABELS = {
  calendar_list: '看日程',
  calendar_create: '建日程',
  reminder_list: '看提醒事项',
  reminder_create: '建提醒事项',
  reminder_complete: '标完成提醒事项',
  shortcut_run: '运行快捷指令',
} as const;

export const IOS_KIND_CLASSES = {
  calendar_list: 'read',
  calendar_create: 'write',
  reminder_list: 'read',
  reminder_create: 'write',
  reminder_complete: 'write',
  shortcut_run: 'command',
} as const;
