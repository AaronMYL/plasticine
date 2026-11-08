// 第 102 条第 4 批：iPhone App 作为设备节点时多出来的动作——日历与提醒事项（EventKit）、相册（PhotoKit）、
// 运行用户的快捷指令（只能在前台打开 shortcuts://）、取当前位置。文件读写沿用 file_list / file_read / file_write：
// iPhone 上的路径是 `~/<用户选过的文件夹名>/…`，列 `~` 得到这些文件夹。参数由云端给齐，设备不补判断。
// 参数 schema 在这里，devices.ts 并进 DeviceActionParamsSchema；结果 schema 并进 node-channel.ts 的 DEVICE_RESULT_SCHEMAS。

import { Type, type Static } from 'typebox';
import type { DeviceActionKind } from '../state.ts';
import { IsoTimeSchema } from './common.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

/** The kinds only the iPhone node reports (it also reports file_list / file_read / file_write). */
export const IOS_ACTION_KINDS = [
  'calendar_list',
  'calendar_create',
  'reminder_list',
  'reminder_create',
  'reminder_complete',
  'photo_list',
  'photo_read',
  'shortcut_run',
  'location_current',
] as const satisfies readonly DeviceActionKind[];

// 日历、提醒的标题和备注：系统日历显示一行标题，备注给够一段话。
export const IOS_TITLE_MAX_CHARS = 200;
export const IOS_NOTES_MAX_CHARS = 2_000;
// 一次最多列多少张照片：给模型看的是清单，挑中了再按编号读一张。
export const IOS_PHOTO_LIST_MAX = 100;
// 读一张照片时长边的像素：256 太小看不清，4096 已经超过附件 10 MiB 的稳妥范围。
export const IOS_PHOTO_PIXELS_MIN = 256;
export const IOS_PHOTO_PIXELS_MAX = 4_096;
// 交给快捷指令的输入文字，和 input_type 一样上限 4 000 字。
export const IOS_SHORTCUT_INPUT_MAX_CHARS = 4_000;

const Title = Type.String({ minLength: 1, maxLength: IOS_TITLE_MAX_CHARS });
const Notes = OrNull(Type.String({ maxLength: IOS_NOTES_MAX_CHARS }));
const ItemId = Type.String({ minLength: 1, maxLength: 200 });

export const IOS_ACTION_PARAM_SCHEMAS = [
  /** 列一段时间里的日程（from ≤ to；设备上最多 92 天一次）。 */
  Type.Object({ kind: Type.Literal('calendar_list'), from: IsoTimeSchema, to: IsoTimeSchema }, STRICT),
  Type.Object({ kind: Type.Literal('calendar_create'), title: Title, start: IsoTimeSchema, end: IsoTimeSchema,
    allDay: Type.Boolean(), location: OrNull(Type.String({ maxLength: IOS_TITLE_MAX_CHARS })), notes: Notes }, STRICT),
  Type.Object({ kind: Type.Literal('reminder_list'), includeCompleted: Type.Boolean() }, STRICT),
  Type.Object({ kind: Type.Literal('reminder_create'), title: Title, due: OrNull(IsoTimeSchema), notes: Notes },
    STRICT),
  Type.Object({ kind: Type.Literal('reminder_complete'), reminderId: ItemId }, STRICT),
  Type.Object({ kind: Type.Literal('photo_list'), limit: Type.Integer({ minimum: 1, maximum: IOS_PHOTO_LIST_MAX }),
    since: OrNull(IsoTimeSchema) }, STRICT),
  Type.Object({ kind: Type.Literal('photo_read'), photoId: ItemId,
    maxPixels: Type.Integer({ minimum: IOS_PHOTO_PIXELS_MIN, maximum: IOS_PHOTO_PIXELS_MAX }) }, STRICT),
  /** 按名字运行用户自己的快捷指令；只能在 App 前台时打开「快捷指令」，跑完靠 x-callback 回到 Plasticine。 */
  Type.Object({ kind: Type.Literal('shortcut_run'), name: Type.String({ minLength: 1, maxLength: 200 }),
    input: OrNull(Type.String({ maxLength: IOS_SHORTCUT_INPUT_MAX_CHARS })) }, STRICT),
  Type.Object({ kind: Type.Literal('location_current') }, STRICT),
] as const;

// 第 15 条（11-06）：Mac 助手进程也回这几种（agent/shared/desktop-helper-protocol.ts），多带日历编号、颜色、
// 有没有别人参加，首页「今天」画日历颜色点、心跳判冲突用；iPhone 不报这几项（可选）。
const HexColor = Type.String({ pattern: '^#[0-9A-Fa-f]{6}$' });
/** 一个日历或提醒事项列表。 */
export const CalendarInfoSchema = Type.Object({ id: Type.String(), title: Type.String(), color: HexColor,
  source: Type.String(), writable: Type.Boolean() }, STRICT);
export type CalendarInfo = Static<typeof CalendarInfoSchema>;
/** 一个日程（重复日程的每一次共用 id，用 id + start 区分）。withOthers：有别人参加，改它要先问他。 */
export const CalendarEventSchema = Type.Object({ id: Type.String(), title: Type.String(),
  start: IsoTimeSchema, end: IsoTimeSchema, allDay: Type.Boolean(), location: OrNull(Type.String()),
  notes: OrNull(Type.String()), calendar: Type.String(), calendarId: Type.Optional(Type.String()),
  color: Type.Optional(HexColor), withOthers: Type.Optional(Type.Boolean()) }, STRICT);
export type CalendarEvent = Static<typeof CalendarEventSchema>;
/** 一条提醒事项；dueHasTime 为假时 due 是那天零点（只有日期）。 */
export const ReminderItemSchema = Type.Object({ id: Type.String(), title: Type.String(),
  due: OrNull(IsoTimeSchema), completed: Type.Boolean(), notes: OrNull(Type.String()), list: Type.String(),
  dueHasTime: Type.Optional(Type.Boolean()), listId: Type.Optional(Type.String()), color: Type.Optional(HexColor) },
STRICT);
export type ReminderItem = Static<typeof ReminderItemSchema>;

const EventReadBack = Type.Object({ title: Type.String(), start: IsoTimeSchema, end: IsoTimeSchema,
  allDay: Type.Boolean() }, STRICT);
const ReminderReadBack = Type.Object({ title: Type.String(), due: OrNull(IsoTimeSchema),
  completed: Type.Boolean() }, STRICT);

/**
 * 回执格式。写的动作带 readBack：设备保存后按编号从系统里重新读出来的那一份（第 102 条「完成证明」），
 * 不是把参数抄一遍。快捷指令 outcome：success 跑完回到了 Plasticine · opened 只打开了、没等到回来。
 */
export const IOS_RESULT_SCHEMAS = {
  calendar_list: Type.Object({ events: Type.Array(CalendarEventSchema), truncated: Type.Boolean() }, STRICT),
  calendar_create: Type.Object({ eventId: Type.String({ minLength: 1 }), readBack: EventReadBack }, STRICT),
  reminder_list: Type.Object({ reminders: Type.Array(ReminderItemSchema), truncated: Type.Boolean(),
    lists: Type.Optional(Type.Array(CalendarInfoSchema)) }, STRICT),
  reminder_create: Type.Object({ reminderId: Type.String({ minLength: 1 }), readBack: ReminderReadBack }, STRICT),
  reminder_complete: Type.Object({ readBack: Type.Object({ title: Type.String(), completed: Type.Boolean() },
    STRICT) }, STRICT),
  photo_list: Type.Object({ photos: Type.Array(Type.Object({ id: Type.String(), createdAt: OrNull(IsoTimeSchema),
    mediaType: Type.Enum(['image', 'video', 'audio', 'unknown']), width: Type.Integer({ minimum: 0 }),
    height: Type.Integer({ minimum: 0 }) }, STRICT)) }, STRICT),
  photo_read: Type.Object({ jpeg: Type.String({ minLength: 1 }), width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }) }, STRICT),
  shortcut_run: Type.Object({ outcome: Type.Enum(['success', 'opened']), output: OrNull(Type.String()) }, STRICT),
  location_current: Type.Object({ latitude: Type.Number({ minimum: -90, maximum: 90 }),
    longitude: Type.Number({ minimum: -180, maximum: 180 }), accuracyMeters: Type.Number({ minimum: 0 }),
    capturedAt: IsoTimeSchema }, STRICT),
} as const;

export const IOS_KIND_LABELS = {
  calendar_list: '看日程',
  calendar_create: '建日程',
  reminder_list: '看提醒事项',
  reminder_create: '建提醒事项',
  reminder_complete: '标完成提醒事项',
  photo_list: '列相册',
  photo_read: '读一张照片',
  shortcut_run: '运行快捷指令',
  location_current: '取当前位置',
} as const;

export const IOS_KIND_CLASSES = {
  calendar_list: 'read',
  calendar_create: 'write',
  reminder_list: 'read',
  reminder_create: 'write',
  reminder_complete: 'write',
  photo_list: 'read',
  photo_read: 'read',
  // 快捷指令能做任何事，按「运行命令」这一类数次数、守上限。
  shortcut_run: 'command',
  location_current: 'read',
} as const;
