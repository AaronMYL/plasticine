// 壳 ↔ Mac 助手进程的 stdio 协议（《优化清单》第 14、15 条，用户 11-06 定）。助手是 mac/ 里的 plasticine-helper
// （Swift，mac/Sources/PlasticineDevice/helper-*.swift），由 Electron 壳拉起；一行一个 JSON：
//   壳 → 助手  { id, method, params? }
//   助手 → 壳  { id, result } 或 { id, error: { code, message } }（读不懂的一行 id 是 null）
// 同一时间可以有多个请求在做，回执顺序不保证，靠 id 对上；cancel { requestId } 取消在做的那一个，被取消的请求自己回
// cancelled。stdin 关了助手就退出。方法名和参数名两边各有一份，agent/tests/shared/desktop-helper-protocol.test.ts
// 读 Swift 源码核对它们一样。设备动作（服务端下发的 DeviceActionParams）到助手方法的换法也在这里：壳收到动作，
// 照 helperCallFor 换成一次助手调用，回执原样交回（日历和提醒事项的回执形状就是设备动作的回执形状）。

import { Type, type Static, type TSchema } from 'typebox';
import { IsoTimeSchema } from './api/common.ts';
import {
  CalendarEventSchema, CalendarInfoSchema, IOS_NOTES_MAX_CHARS, IOS_RESULT_SCHEMAS, IOS_TITLE_MAX_CHARS,
  ReminderItemSchema,
} from './api/device-ios.ts';
import type { DeviceActionParams } from './api/devices.ts';
import { DEVICE_RESULT_SCHEMAS } from './api/node-channel.ts';
import type { DeviceActionKind } from './state.ts';

const STRICT = { additionalProperties: false };

/** 改了已有方法的参数或回执形状才加一（Swift 那边是 HelperProtocol.version）。 */
export const HELPER_PROTOCOL_VERSION = 1;
export const HELPER_ID_MAX_CHARS = 200;
export const HELPER_TYPE_MAX_CHARS = 4_000;
export const HELPER_SCROLL_MAX_LINES = 200;
export const HELPER_COMMAND_SECONDS_MAX = 600;
export const HELPER_COMMAND_OUTPUT_MAX_BYTES = 100 * 1024;
export const HELPER_CALENDAR_WINDOW_MAX_DAYS = 92;

export const HELPER_ERROR_CODES = [
  'invalid_request', 'unknown_method', 'invalid_params', 'refused', 'failed', 'cancelled', 'permission_denied',
  'needs_confirmation', 'screenshot_stale', 'not_found', 'duplicate_id',
] as const;
export type HelperErrorCode = (typeof HELPER_ERROR_CODES)[number];

export const HELPER_PERMISSIONS = ['screen', 'accessibility', 'calendar', 'reminders'] as const;
export type HelperPermission = (typeof HELPER_PERMISSIONS)[number];
/** 日历、提醒事项的授权状态（EventKit）：只有 granted 才读得到。 */
export const CALENDAR_ACCESS_STATES = ['granted', 'write_only', 'denied', 'restricted', 'not_determined'] as const;

const Id = Type.String({ minLength: 1, maxLength: HELPER_ID_MAX_CHARS });
const Path = Type.String({ minLength: 1, maxLength: 4_096 });
const Point = Type.Integer({ minimum: 0, maximum: 100_000 });
const Lines = Type.Integer({ minimum: -HELPER_SCROLL_MAX_LINES, maximum: HELPER_SCROLL_MAX_LINES });
const ItemId = Type.String({ minLength: 1, maxLength: 200 });
const Title = Type.String({ minLength: 1, maxLength: IOS_TITLE_MAX_CHARS });
const OptionalText = (max: number) => Type.Optional(Type.Union([Type.String({ maxLength: max }), Type.Null()]));
const Ids = Type.Optional(Type.Array(ItemId, { maxItems: 50 }));
const Empty = Type.Object({}, STRICT);

export const HelperRequestSchema = Type.Object({
  id: Id,
  method: Type.String({ minLength: 1 }),
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, STRICT);
export type HelperRequest = Static<typeof HelperRequestSchema>;

export const HelperErrorSchema = Type.Object({ code: Type.Enum(HELPER_ERROR_CODES), message: Type.String() }, STRICT);
export type HelperError = Static<typeof HelperErrorSchema>;
export const HelperResponseSchema = Type.Union([
  Type.Object({ id: Id, result: Type.Record(Type.String(), Type.Unknown()) }, STRICT),
  Type.Object({ id: Type.Union([Id, Type.Null()]), error: HelperErrorSchema }, STRICT),
]);
export type HelperResponse = Static<typeof HelperResponseSchema>;

const InputResult = DEVICE_RESULT_SCHEMAS.input_click;
const AccessState = Type.Enum(CALENDAR_ACCESS_STATES);

/** 每个方法的参数和回执。参数全是可选或必填的扁平对象，多出来的键助手会拒（invalid_params）。 */
export const HELPER_METHODS = {
  'helper.info': {
    params: Empty,
    result: Type.Object({ name: Type.String(), version: Type.String(), protocol: Type.Integer({ minimum: 1 }),
      methods: Type.Array(Type.String()) }, STRICT),
  },
  /** 授权目录（他在设置里选的）；空列表是不授权文件。默认整个家目录。 */
  'helper.configure': {
    params: Type.Object({ roots: Type.Array(Path, { maxItems: 50 }) }, STRICT),
    result: Type.Object({ roots: Type.Array(Type.String()) }, STRICT),
  },
  cancel: {
    params: Type.Object({ requestId: Id }, STRICT),
    result: Type.Object({ cancelled: Type.Boolean() }, STRICT),
  },
  'permissions.status': {
    params: Empty,
    result: Type.Object({ screen: Type.Boolean(), accessibility: Type.Boolean(), calendar: AccessState,
      reminders: AccessState }, STRICT),
  },
  /** 弹系统授权框（第一次），拒过的打开「系统设置」那一页。 */
  'permissions.request': {
    params: Type.Object({ kind: Type.Enum(HELPER_PERMISSIONS) }, STRICT),
    result: Type.Object({ kind: Type.Enum(HELPER_PERMISSIONS), granted: Type.Boolean(),
      settingsOpened: Type.Boolean() }, STRICT),
  },
  screenshot: { params: Empty, result: DEVICE_RESULT_SCHEMAS.screen_capture },
  click: { params: Type.Object({ x: Point, y: Point }, STRICT), result: InputResult },
  type: {
    params: Type.Object({ text: Type.String({ minLength: 1, maxLength: HELPER_TYPE_MAX_CHARS }) }, STRICT),
    result: InputResult,
  },
  /** 「cmd+shift+4」「return」「escape」：修饰键 cmd / shift / option / control / fn。 */
  key: { params: Type.Object({ keys: Type.String({ minLength: 1, maxLength: 60 }) }, STRICT), result: InputResult },
  /** 按行滚：dy 正数往下翻，dx 正数往右；给坐标先把指针移过去（按最近一次截图换算）。 */
  scroll: {
    params: Type.Object({ dx: Type.Optional(Lines), dy: Type.Optional(Lines), x: Type.Optional(Point),
      y: Type.Optional(Point) }, STRICT),
    result: InputResult,
  },
  'files.list': { params: Type.Object({ path: Path }, STRICT), result: DEVICE_RESULT_SCHEMAS.file_list },
  'files.read': { params: Type.Object({ path: Path }, STRICT), result: DEVICE_RESULT_SCHEMAS.file_read },
  'files.write': {
    params: Type.Object({ path: Path, content: Type.String(),
      baseVersion: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]) }, STRICT),
    result: DEVICE_RESULT_SCHEMAS.file_write,
  },
  /** 默认 120 秒、stdout / stderr 各 100 KiB；可以按次收紧输出、放宽到 10 分钟。 */
  'command.run': {
    params: Type.Object({ command: Type.String({ minLength: 1, maxLength: 20_000 }), cwd: Path,
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: HELPER_COMMAND_SECONDS_MAX })),
      maxOutputBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: HELPER_COMMAND_OUTPUT_MAX_BYTES })) },
    STRICT),
    result: DEVICE_RESULT_SCHEMAS.run_command,
  },
  'calendar.list': {
    params: Empty,
    result: Type.Object({ calendars: Type.Array(CalendarInfoSchema) }, STRICT),
  },
  'calendar.events': {
    params: Type.Object({ from: IsoTimeSchema, to: IsoTimeSchema, calendarIds: Ids }, STRICT),
    result: IOS_RESULT_SCHEMAS.calendar_list,
  },
  'calendar.create': {
    params: Type.Object({ title: Title, start: IsoTimeSchema, end: IsoTimeSchema, allDay: Type.Optional(Type.Boolean()),
      location: OptionalText(IOS_TITLE_MAX_CHARS), notes: OptionalText(IOS_NOTES_MAX_CHARS),
      calendarId: Type.Optional(ItemId) }, STRICT),
    result: IOS_RESULT_SCHEMAS.calendar_create,
  },
  /**
   * 改一个日程：只改给了的项，location / notes 给 null 是清空。有别人参加的日程要带 confirmed: true（服务端出卡、
   * 他点了），否则回 needs_confirmation。重复日程给 occurrenceStart 只改那一次。
   */
  'calendar.update': {
    params: Type.Object({ eventId: ItemId, occurrenceStart: Type.Optional(IsoTimeSchema), title: Type.Optional(Title),
      start: Type.Optional(IsoTimeSchema), end: Type.Optional(IsoTimeSchema), allDay: Type.Optional(Type.Boolean()),
      location: OptionalText(IOS_TITLE_MAX_CHARS), notes: OptionalText(IOS_NOTES_MAX_CHARS),
      confirmed: Type.Optional(Type.Boolean()) }, STRICT),
    result: IOS_RESULT_SCHEMAS.calendar_create,
  },
  'reminders.list': {
    params: Type.Object({ includeCompleted: Type.Optional(Type.Boolean()), listIds: Ids }, STRICT),
    result: IOS_RESULT_SCHEMAS.reminder_list,
  },
  'reminders.create': {
    params: Type.Object({ title: Title, due: Type.Optional(Type.Union([IsoTimeSchema, Type.Null()])),
      notes: OptionalText(IOS_NOTES_MAX_CHARS), listId: Type.Optional(ItemId) }, STRICT),
    result: IOS_RESULT_SCHEMAS.reminder_create,
  },
  'reminders.complete': {
    params: Type.Object({ reminderId: ItemId }, STRICT),
    result: IOS_RESULT_SCHEMAS.reminder_complete,
  },
} as const satisfies Record<string, { params: TSchema; result: TSchema }>;

export type HelperMethod = keyof typeof HELPER_METHODS;
export const HELPER_METHOD_NAMES = Object.keys(HELPER_METHODS) as HelperMethod[];
export type HelperParams<M extends HelperMethod> = Static<(typeof HELPER_METHODS)[M]['params']>;
export type HelperResult<M extends HelperMethod> = Static<(typeof HELPER_METHODS)[M]['result']>;

export function isHelperMethod(name: string): name is HelperMethod {
  return Object.hasOwn(HELPER_METHODS, name);
}

/** 一次助手调用：方法和参数。 */
export interface HelperCall {
  method: HelperMethod;
  params: Record<string, unknown>;
}

/** 助手做得了的设备动作；浏览器、网页标签、应用、删除留给壳（Electron）自己做。 */
export const HELPER_DEVICE_KINDS = [
  'file_list', 'file_read', 'file_write', 'run_command', 'screen_capture', 'input_click', 'input_type',
  'calendar_list', 'calendar_create', 'reminder_list', 'reminder_create', 'reminder_complete',
] as const satisfies readonly DeviceActionKind[];
export type HelperDeviceKind = (typeof HELPER_DEVICE_KINDS)[number];

/**
 * 服务端下发的设备动作换成一次助手调用；不归助手的回 null（壳自己做）。回执形状和设备动作的回执一样，
 * 壳原样交回。
 */
export function helperCallFor(action: DeviceActionParams): HelperCall | null {
  switch (action.kind) {
    case 'file_list': return { method: 'files.list', params: { path: action.path } };
    case 'file_read': return { method: 'files.read', params: { path: action.path } };
    case 'file_write':
      return { method: 'files.write', params: { path: action.path, content: action.content,
        baseVersion: action.baseVersion } };
    case 'run_command': return { method: 'command.run', params: { command: action.command, cwd: action.cwd } };
    case 'screen_capture': return { method: 'screenshot', params: {} };
    case 'input_click': return { method: 'click', params: { x: action.x, y: action.y } };
    case 'input_type': return { method: 'type', params: { text: action.text } };
    case 'calendar_list': return { method: 'calendar.events', params: { from: action.from, to: action.to } };
    case 'calendar_create':
      return { method: 'calendar.create', params: { title: action.title, start: action.start, end: action.end,
        allDay: action.allDay, location: action.location, notes: action.notes } };
    case 'reminder_list':
      return { method: 'reminders.list', params: { includeCompleted: action.includeCompleted } };
    case 'reminder_create':
      return { method: 'reminders.create', params: { title: action.title, due: action.due, notes: action.notes } };
    case 'reminder_complete': return { method: 'reminders.complete', params: { reminderId: action.reminderId } };
    default: return null;
  }
}

/**
 * 按 permissions.status 算壳该在 hello 里报哪些设备能力：没给屏幕录制就不报截图，没给辅助功能就不报点按，
 * 日历和提醒事项要完全访问。文件和命令不要系统权限，总是报。
 */
export function helperCapabilities(status: HelperResult<'permissions.status'>): HelperDeviceKind[] {
  return HELPER_DEVICE_KINDS.filter((kind) => {
    switch (kind) {
      case 'screen_capture': return status.screen;
      case 'input_click':
      case 'input_type': return status.accessibility;
      case 'calendar_list':
      case 'calendar_create': return status.calendar === 'granted';
      case 'reminder_list':
      case 'reminder_create':
      case 'reminder_complete': return status.reminders === 'granted';
      default: return true;
    }
  });
}

export { CalendarEventSchema, ReminderItemSchema };
