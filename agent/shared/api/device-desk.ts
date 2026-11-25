import { Type } from 'typebox';
import type { DeviceActionClass, DeviceActionKind } from '../state.ts';
import { IsoTimeSchema } from './common.ts';
import { DevicePathSchema, WebTabIdSchema } from './device-hands.ts';
import { IOS_NOTES_MAX_CHARS, IOS_TITLE_MAX_CHARS } from './device-ios.ts';
import { OrNull } from './lineage.ts';

const STRICT = { additionalProperties: false };

export const CLIPBOARD_MAX_CHARS = 200_000;
export const APP_SCRIPT_MAX_CHARS = 20_000;
export const FILE_FIND_MAX = 200;
export const APP_ELEMENTS_MAX = 400;
const Point = Type.Integer({ minimum: 0, maximum: 100_000 });
const Lines = Type.Integer({ minimum: -200, maximum: 200 });
const Size = Type.Integer({ minimum: 1, maximum: 100_000 });
const AppName = Type.String({ minLength: 1, maxLength: 200 });
const WindowId = Type.String({ minLength: 3, maxLength: 40, pattern: '^\\d+:\\d+$' });
const Version = Type.String({ minLength: 1, maxLength: 40 });
const Keys = Type.String({ minLength: 1, maxLength: 60 });

type DeskKind = Extract<DeviceActionKind, 'device_state' | 'clipboard_read' | 'clipboard_write' | 'folder_request'
  | 'file_find' | 'open_in_app' | 'app_script' | 'shortcut_list' | 'calendar_update' | 'tab_hover' | 'tab_drag'
  | 'tab_downloads' | 'tab_dialog' | 'input_key' | 'input_scroll' | 'input_mouse' | 'screen_zoom' | 'window_capture'
  | 'app_list' | 'window_list' | 'window_act' | 'app_perceive' | 'app_act' | 'app_menu'>;

export const DESK_KIND_LABELS: Readonly<Record<DeskKind, string>> = {
  device_state: '看电脑现在的状态',
  clipboard_read: '读剪贴板',
  clipboard_write: '往剪贴板放东西',
  folder_request: '请你选一个文件夹授权',
  file_find: '按名字找文件',
  open_in_app: '用应用打开文件或网址',
  app_script: '跑一段 AppleScript',
  shortcut_list: '列出快捷指令',
  calendar_update: '改日程',
  tab_hover: '在网页标签里悬停',
  tab_drag: '在网页标签里拖动',
  tab_downloads: '看网页下载了什么',
  tab_dialog: '答网页弹出的对话框',
  input_key: '按键盘',
  input_scroll: '滚动屏幕',
  input_mouse: '用鼠标双击、右键或拖动',
  screen_zoom: '截屏幕的一块',
  window_capture: '截一个窗口',
  app_list: '列出开着的应用',
  window_list: '列出窗口',
  window_act: '改一个窗口',
  app_perceive: '读应用的界面',
  app_act: '在应用里操作',
  app_menu: '用应用的菜单',
};

export const DESK_KIND_CLASSES: Readonly<Record<DeskKind, DeviceActionClass>> = {
  device_state: 'read',
  clipboard_read: 'read',
  clipboard_write: 'input',
  folder_request: 'read',
  file_find: 'read',
  open_in_app: 'browser',
  app_script: 'command',
  shortcut_list: 'read',
  calendar_update: 'write',
  tab_hover: 'browser',
  tab_drag: 'input',
  tab_downloads: 'read',
  tab_dialog: 'input',
  input_key: 'input',
  input_scroll: 'input',
  input_mouse: 'input',
  screen_zoom: 'read',
  window_capture: 'read',
  app_list: 'read',
  window_list: 'read',
  window_act: 'input',
  app_perceive: 'read',
  app_act: 'input',
  app_menu: 'input',
};

export const DESK_ACTION_PARAM_SCHEMAS = [
  Type.Object({ kind: Type.Literal('device_state') }, STRICT),
  Type.Object({ kind: Type.Literal('clipboard_read') }, STRICT),
  Type.Object({ kind: Type.Literal('clipboard_write'),
    text: Type.String({ minLength: 1, maxLength: CLIPBOARD_MAX_CHARS }),
    html: OrNull(Type.String({ minLength: 1, maxLength: CLIPBOARD_MAX_CHARS })) }, STRICT),
  Type.Object({ kind: Type.Literal('folder_request'), reason: Type.String({ minLength: 2, maxLength: 120 }) }, STRICT),
  Type.Object({ kind: Type.Literal('file_find'), root: DevicePathSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }), limit: Type.Integer({ minimum: 1, maximum: FILE_FIND_MAX }) },
  STRICT),
  Type.Object({ kind: Type.Literal('open_in_app'), target: Type.String({ minLength: 1, maxLength: 2_000 }),
    app: OrNull(AppName) }, STRICT),
  Type.Object({ kind: Type.Literal('app_script'),
    script: Type.String({ minLength: 1, maxLength: APP_SCRIPT_MAX_CHARS }) }, STRICT),
  Type.Object({ kind: Type.Literal('shortcut_list') }, STRICT),
  Type.Object({ kind: Type.Literal('calendar_update'), eventId: Type.String({ minLength: 1, maxLength: 200 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: IOS_TITLE_MAX_CHARS })),
    start: Type.Optional(IsoTimeSchema), end: Type.Optional(IsoTimeSchema),
    location: Type.Optional(OrNull(Type.String({ maxLength: IOS_TITLE_MAX_CHARS }))),
    notes: Type.Optional(OrNull(Type.String({ maxLength: IOS_NOTES_MAX_CHARS }))),
    confirmed: Type.Optional(Type.Boolean()) }, STRICT),
  Type.Object({ kind: Type.Literal('tab_hover'), tabId: WebTabIdSchema, x: Point, y: Point }, STRICT),
  Type.Object({ kind: Type.Literal('tab_drag'), tabId: WebTabIdSchema, x: Point, y: Point, toX: Point, toY: Point },
  STRICT),
  Type.Object({ kind: Type.Literal('tab_downloads') }, STRICT),
  Type.Object({ kind: Type.Literal('tab_dialog'), tabId: WebTabIdSchema, accept: Type.Boolean(),
    text: OrNull(Type.String({ maxLength: 1_000 })) }, STRICT),
  Type.Object({ kind: Type.Literal('input_key'), keys: Keys }, STRICT),
  Type.Object({ kind: Type.Literal('input_scroll'), dx: Lines, dy: Lines, x: OrNull(Point), y: OrNull(Point) }, STRICT),
  Type.Object({ kind: Type.Literal('input_mouse'),
    op: Type.Union([Type.Literal('double'), Type.Literal('right'), Type.Literal('middle'), Type.Literal('move'),
      Type.Literal('drag')]), x: Point, y: Point, toX: OrNull(Point), toY: OrNull(Point) }, STRICT),
  Type.Object({ kind: Type.Literal('screen_zoom'), x: Point, y: Point, width: Size, height: Size }, STRICT),
  Type.Object({ kind: Type.Literal('window_capture'), window: WindowId }, STRICT),
  Type.Object({ kind: Type.Literal('app_list') }, STRICT),
  Type.Object({ kind: Type.Literal('window_list') }, STRICT),
  Type.Object({ kind: Type.Literal('window_act'), window: WindowId,
    op: Type.Union([Type.Literal('raise'), Type.Literal('minimize'), Type.Literal('restore'), Type.Literal('close'),
      Type.Literal('move'), Type.Literal('resize')]),
    x: OrNull(Type.Integer()), y: OrNull(Type.Integer()), width: OrNull(Size), height: OrNull(Size) }, STRICT),
  Type.Object({ kind: Type.Literal('app_perceive'), app: AppName }, STRICT),
  Type.Object({ kind: Type.Literal('app_act'), app: AppName, version: Version, n: Type.Integer({ minimum: 1 }),
    op: Type.Union([Type.Literal('press'), Type.Literal('focus'), Type.Literal('set'), Type.Literal('increment'),
      Type.Literal('decrement'), Type.Literal('menu'), Type.Literal('confirm'), Type.Literal('cancel'),
      Type.Literal('show')]), text: OrNull(Type.String({ maxLength: 4_000 })) }, STRICT),
  Type.Object({ kind: Type.Literal('app_menu'), app: AppName,
    path: OrNull(Type.String({ minLength: 1, maxLength: 300 })) }, STRICT),
] as const;

const Text = Type.String();
const Png = { png: Type.String(), width: Type.Integer({ minimum: 1 }), height: Type.Integer({ minimum: 1 }) };
const InputResultLike = Type.Object({ afterShot: Type.Optional(Type.Unknown()),
  changed: Type.Optional(Type.Boolean()) }, STRICT);
const Frame = { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() };

export const AppElementSchema = Type.Object({
  n: Type.Integer({ minimum: 1 }), role: Text, title: Text, value: OrNull(Text), enabled: Type.Boolean(),
  focused: Type.Boolean(), actions: Type.Array(Text), ...Frame,
}, STRICT);

export const DESK_RESULT_SCHEMAS = {
  device_state: Type.Object({ idleSeconds: Type.Integer({ minimum: 0 }), locked: Type.Boolean(),
    onBattery: Type.Boolean(), keptAwake: Type.Boolean() }, STRICT),
  clipboard_read: Type.Object({ text: Text, html: OrNull(Text) }, STRICT),
  clipboard_write: Type.Object({}, STRICT),
  folder_request: Type.Object({ path: OrNull(Text) }, STRICT),
  file_find: Type.Object({ matches: Type.Array(Type.Object({ path: Text, type: Type.Union([Type.Literal('file'),
    Type.Literal('dir')]), size: Type.Number({ minimum: 0 }), modifiedAt: IsoTimeSchema }, STRICT)),
  truncated: Type.Boolean() }, STRICT),
  open_in_app: Type.Object({}, STRICT),
  app_script: Type.Object({ output: Text }, STRICT),
  shortcut_list: Type.Object({ shortcuts: Type.Array(Text) }, STRICT),
  calendar_update: Type.Object({ eventId: Type.String({ minLength: 1 }), readBack: Type.Unknown() }, STRICT),
  tab_hover: Type.Object({ tabId: Text }, STRICT),
  tab_drag: Type.Object({ tabId: Text }, STRICT),
  tab_downloads: Type.Object({ downloads: Type.Array(Type.Object({ name: Text, path: Text, url: Text,
    bytes: Type.Number({ minimum: 0 }), state: Type.Union([Type.Literal('progressing'), Type.Literal('completed'),
      Type.Literal('cancelled'), Type.Literal('interrupted')]), startedAt: IsoTimeSchema }, STRICT)) }, STRICT),
  tab_dialog: Type.Object({ tabId: Text, armed: Type.Boolean(), last: OrNull(Type.Object({ type: Text, message: Text,
    answered: Text, at: IsoTimeSchema }, STRICT)) }, STRICT),
  input_key: InputResultLike,
  input_scroll: InputResultLike,
  input_mouse: InputResultLike,
  screen_zoom: Type.Object(Png, STRICT),
  window_capture: Type.Object(Png, STRICT),
  app_list: Type.Object({ apps: Type.Array(Type.Object({ pid: Type.Integer(), name: Text, bundleId: Text,
    active: Type.Boolean(), hidden: Type.Boolean() }, STRICT)) }, STRICT),
  window_list: Type.Object({ windows: Type.Array(Type.Object({ id: Text, pid: Type.Integer(), app: Text, title: Text,
    minimized: Type.Boolean(), ...Frame }, STRICT)) }, STRICT),
  window_act: Type.Object({ window: Text }, STRICT),
  app_perceive: Type.Object({ app: Text, pid: Type.Integer(), version: Text, window: Text,
    elements: Type.Array(AppElementSchema), truncated: Type.Boolean() }, STRICT),
  app_act: Type.Object({ done: Type.Boolean(), value: OrNull(Text) }, STRICT),
  app_menu: Type.Object({ items: Type.Array(Type.Object({ path: Text, enabled: Type.Boolean() }, STRICT)),
    pressed: OrNull(Text) }, STRICT),
} as const;
