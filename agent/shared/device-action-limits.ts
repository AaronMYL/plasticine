// 每种设备动作最多做多久（11-16）：18:48 那次截图在隐藏标签上一直不返回，整个设备服务跟着卡住、不再报到。
// 现在每个动作都有时限（设备照它放下卡住的动作，服务器照它判「卡住」），到点就交回「卡在哪一步、能不能直接再做」，
// 设备服务接着领下一个；那个没返回的就地放下。
// 时限按动作本身最慢的正常情况定，留足余量；跑命令按它自己带的时限再加半分钟。

import type { DeviceActionKind } from './state.ts';

const SECOND = 1000;
const DEFAULT_LIMIT_MS = 120 * SECOND;
const COMMAND_EXTRA_MS = 30 * SECOND;
const COMMAND_DEFAULT_MS = 300 * SECOND;

const LIMITS_MS: Partial<Record<DeviceActionKind, number>> = {
  tab_list: 15 * SECOND,
  tab_shot: 25 * SECOND,
  tab_close: 15 * SECOND,
  tab_wait: 45 * SECOND,
  tab_point: 30 * SECOND,
  tab_type: 30 * SECOND,
  tab_click: 30 * SECOND,
  tab_fill: 30 * SECOND,
  tab_act: 45 * SECOND,
  tab_perceive: 60 * SECOND,
  tab_read: 60 * SECOND,
  tab_open: 60 * SECOND,
  tab_navigate: 60 * SECOND,
  tab_key: 30 * SECOND,
  tab_scroll: 30 * SECOND,
  tab_paste: 30 * SECOND,
  tab_show: 15 * SECOND,
  tab_upload: 90 * SECOND,
  file_fetch: 120 * SECOND,
  file_put: 120 * SECOND,
  screen_capture: 30 * SECOND,
  input_click: 45 * SECOND,
  input_type: 45 * SECOND,
  app_open: 30 * SECOND,
  browser_open: 20 * SECOND,
  browser_read: 90 * SECOND,
  file_list: 60 * SECOND,
  file_read: 60 * SECOND,
  file_write: 60 * SECOND,
  file_delete: 60 * SECOND,
  device_state: 15 * SECOND,
  clipboard_read: 15 * SECOND,
  clipboard_write: 15 * SECOND,
  // 等他在系统的「选择文件夹」里选：给足五分钟。
  folder_request: 300 * SECOND,
  file_find: 90 * SECOND,
  open_in_app: 30 * SECOND,
  app_script: 120 * SECOND,
  shortcut_list: 30 * SECOND,
  calendar_update: 60 * SECOND,
  tab_hover: 30 * SECOND,
  tab_drag: 30 * SECOND,
  tab_downloads: 15 * SECOND,
  tab_dialog: 15 * SECOND,
  input_key: 45 * SECOND,
  input_scroll: 45 * SECOND,
  input_mouse: 45 * SECOND,
  screen_zoom: 30 * SECOND,
  window_capture: 30 * SECOND,
  app_list: 15 * SECOND,
  window_list: 20 * SECOND,
  window_act: 20 * SECOND,
  app_perceive: 60 * SECOND,
  app_act: 30 * SECOND,
  app_menu: 30 * SECOND,
  calendar_list: 60 * SECOND,
  calendar_create: 60 * SECOND,
  reminder_list: 60 * SECOND,
  reminder_create: 60 * SECOND,
  reminder_complete: 60 * SECOND,
};

/** 只读、做两遍也没有副作用的：卡住了可以直接再做。 */
const RETRYABLE: ReadonlySet<DeviceActionKind> = new Set<DeviceActionKind>(['tab_list', 'tab_shot', 'tab_wait',
  'tab_close', 'tab_perceive', 'tab_show', 'tab_scroll', 'file_fetch',
  'tab_read', 'screen_capture', 'file_list', 'file_read', 'browser_read', 'calendar_list', 'reminder_list',
  'photo_list', 'photo_read', 'location_current', 'device_state', 'file_find', 'shortcut_list', 'tab_downloads',
  'screen_zoom', 'window_capture', 'app_list', 'window_list', 'app_perceive', 'tab_hover']);

export function actionLimitMs(kind: DeviceActionKind, params: Record<string, unknown>): number {
  if (kind === 'run_command') {
    const own = typeof params.timeoutMs === 'number' && params.timeoutMs > 0 ? params.timeoutMs : null;
    return own === null ? COMMAND_DEFAULT_MS : own + COMMAND_EXTRA_MS;
  }
  return LIMITS_MS[kind] ?? DEFAULT_LIMIT_MS;
}

export function actionRetryable(kind: DeviceActionKind): boolean {
  return RETRYABLE.has(kind);
}
