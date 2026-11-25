import { Type, type Static, type TSchema } from 'typebox';
import { IsoTimeSchema } from './api/common.ts';
import {
  CalendarEventSchema, CalendarInfoSchema, IOS_NOTES_MAX_CHARS, IOS_RESULT_SCHEMAS, IOS_TITLE_MAX_CHARS,
  ReminderItemSchema,
} from './api/device-ios.ts';
import { DESK_RESULT_SCHEMAS } from './api/device-desk.ts';
import type { DeviceActionParams } from './api/devices.ts';
import { DEVICE_RESULT_SCHEMAS } from './api/node-channel.ts';
import type { DeviceActionKind } from './state.ts';

const STRICT = { additionalProperties: false };

export const HELPER_ID_MAX_CHARS = 200;
export const HELPER_TYPE_MAX_CHARS = 4_000;
export const HELPER_SCROLL_MAX_LINES = 200;
export const HELPER_COMMAND_SECONDS_MAX = 600;
export const HELPER_COMMAND_OUTPUT_MAX_BYTES = 100 * 1024;

export const HELPER_ERROR_CODES = [
  'invalid_request', 'unknown_method', 'invalid_params', 'refused', 'failed', 'cancelled', 'permission_denied',
  'needs_confirmation', 'screenshot_stale', 'not_found', 'duplicate_id',
] as const;
export type HelperErrorCode = (typeof HELPER_ERROR_CODES)[number];

export const HELPER_PERMISSIONS = ['screen', 'accessibility', 'calendar', 'reminders'] as const;
export type HelperPermission = (typeof HELPER_PERMISSIONS)[number];
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

export const HELPER_METHODS = {
  'helper.info': {
    params: Empty,
    result: Type.Object({ name: Type.String(), version: Type.String(), protocol: Type.Integer({ minimum: 1 }),
      methods: Type.Array(Type.String()) }, STRICT),
  },
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
  key: { params: Type.Object({ keys: Type.String({ minLength: 1, maxLength: 60 }) }, STRICT), result: InputResult },
  scroll: {
    params: Type.Object({ dx: Type.Optional(Lines), dy: Type.Optional(Lines), x: Type.Optional(Point),
      y: Type.Optional(Point) }, STRICT),
    result: InputResult,
  },
  mouse: {
    params: Type.Object({ op: Type.Union([Type.Literal('double'), Type.Literal('right'), Type.Literal('middle'),
      Type.Literal('move'), Type.Literal('drag')]), x: Point, y: Point, toX: Type.Optional(Point),
    toY: Type.Optional(Point) }, STRICT),
    result: InputResult,
  },
  'screenshot.region': {
    params: Type.Object({ x: Point, y: Point, width: Point, height: Point }, STRICT),
    result: DEVICE_RESULT_SCHEMAS.screen_capture,
  },
  'screenshot.window': { params: Type.Object({ window: Id }, STRICT), result: DEVICE_RESULT_SCHEMAS.screen_capture },
  'apps.list': { params: Empty, result: DESK_RESULT_SCHEMAS.app_list },
  'windows.list': { params: Empty, result: DESK_RESULT_SCHEMAS.window_list },
  'window.act': {
    params: Type.Object({ window: Id, op: Type.String({ minLength: 1, maxLength: 20 }),
      x: Type.Optional(Type.Integer()), y: Type.Optional(Type.Integer()), width: Type.Optional(Point),
      height: Type.Optional(Point) }, STRICT),
    result: DESK_RESULT_SCHEMAS.window_act,
  },
  'ax.perceive': { params: Type.Object({ app: Id }, STRICT), result: DESK_RESULT_SCHEMAS.app_perceive },
  'ax.act': {
    params: Type.Object({ app: Id, version: Id, n: Type.Integer({ minimum: 1 }),
      op: Type.String({ minLength: 1, maxLength: 20 }), text: Type.Optional(Type.String({ maxLength: 4_000 })) },
    STRICT),
    result: DESK_RESULT_SCHEMAS.app_act,
  },
  'menu.list': { params: Type.Object({ app: Id }, STRICT), result: DESK_RESULT_SCHEMAS.app_menu },
  'menu.press': {
    params: Type.Object({ app: Id, path: Type.String({ minLength: 1, maxLength: 300 }) }, STRICT),
    result: DESK_RESULT_SCHEMAS.app_menu,
  },
  'files.list': { params: Type.Object({ path: Path }, STRICT), result: DEVICE_RESULT_SCHEMAS.file_list },
  'files.read': { params: Type.Object({ path: Path }, STRICT), result: DEVICE_RESULT_SCHEMAS.file_read },
  'files.write': {
    params: Type.Object({ path: Path, content: Type.String(),
      baseVersion: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]) }, STRICT),
    result: DEVICE_RESULT_SCHEMAS.file_write,
  },
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

export interface HelperCall {
  method: HelperMethod;
  params: Record<string, unknown>;
}

export const HELPER_DEVICE_KINDS = [
  'file_list', 'file_read', 'file_write', 'run_command', 'screen_capture', 'input_click', 'input_type',
  'calendar_list', 'calendar_create', 'reminder_list', 'reminder_create', 'reminder_complete',
  'calendar_update', 'input_key', 'input_scroll', 'input_mouse', 'screen_zoom', 'window_capture', 'app_list',
  'window_list', 'window_act', 'app_perceive', 'app_act', 'app_menu',
] as const satisfies readonly DeviceActionKind[];

const KIND_METHODS: Readonly<Record<HelperDeviceKind, HelperMethod>> = {
  file_list: 'files.list', file_read: 'files.read', file_write: 'files.write', run_command: 'command.run',
  screen_capture: 'screenshot', input_click: 'click', input_type: 'type', calendar_list: 'calendar.events',
  calendar_create: 'calendar.create', reminder_list: 'reminders.list', reminder_create: 'reminders.create',
  reminder_complete: 'reminders.complete', calendar_update: 'calendar.update', input_key: 'key',
  input_scroll: 'scroll', input_mouse: 'mouse', screen_zoom: 'screenshot.region', window_capture: 'screenshot.window',
  app_list: 'apps.list', window_list: 'windows.list', window_act: 'window.act', app_perceive: 'ax.perceive',
  app_act: 'ax.act', app_menu: 'menu.list',
};
export type HelperDeviceKind = (typeof HELPER_DEVICE_KINDS)[number];

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
    default: return deskCallFor(action);
  }
}

function present(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== null && value !== undefined));
}

function deskCallFor(action: DeviceActionParams): HelperCall | null {
  switch (action.kind) {
    case 'calendar_update':
      return { method: 'calendar.update', params: present({ eventId: action.eventId, title: action.title,
        start: action.start, end: action.end, location: action.location, notes: action.notes,
        confirmed: action.confirmed }) };
    case 'input_key': return { method: 'key', params: { keys: action.keys } };
    case 'input_scroll': return { method: 'scroll', params: present({ dx: action.dx, dy: action.dy, x: action.x,
      y: action.y }) };
    case 'input_mouse': return { method: 'mouse', params: present({ op: action.op, x: action.x, y: action.y,
      toX: action.toX, toY: action.toY }) };
    case 'screen_zoom': return { method: 'screenshot.region', params: { x: action.x, y: action.y,
      width: action.width, height: action.height } };
    case 'window_capture': return { method: 'screenshot.window', params: { window: action.window } };
    case 'app_list': return { method: 'apps.list', params: {} };
    case 'window_list': return { method: 'windows.list', params: {} };
    case 'window_act': return { method: 'window.act', params: present({ window: action.window, op: action.op,
      x: action.x, y: action.y, width: action.width, height: action.height }) };
    case 'app_perceive': return { method: 'ax.perceive', params: { app: action.app } };
    case 'app_act': return { method: 'ax.act', params: present({ app: action.app, version: action.version,
      n: action.n, op: action.op, text: action.text }) };
    case 'app_menu': return action.path === null ? { method: 'menu.list', params: { app: action.app } }
      : { method: 'menu.press', params: { app: action.app, path: action.path } };
    default: return null;
  }
}

export function helperCapabilities(status: HelperResult<'permissions.status'>, methods?: readonly string[])
  : HelperDeviceKind[] {
  return HELPER_DEVICE_KINDS.filter((kind) => {
    if (methods !== undefined && !methods.includes(KIND_METHODS[kind])) return false;
    switch (kind) {
      case 'screen_capture':
      case 'screen_zoom':
      case 'window_capture': return status.screen;
      case 'input_click':
      case 'input_type':
      case 'input_key':
      case 'input_scroll':
      case 'input_mouse':
      case 'window_act':
      case 'window_list':
      case 'app_perceive':
      case 'app_act':
      case 'app_menu': return status.accessibility;
      case 'calendar_list':
      case 'calendar_update':
      case 'calendar_create': return status.calendar === 'granted';
      case 'reminder_list':
      case 'reminder_create':
      case 'reminder_complete': return status.reminders === 'granted';
      default: return true;
    }
  });
}

export { CalendarEventSchema, ReminderItemSchema };
