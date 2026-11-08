// 让他给 Plasticine 截屏、辅助功能、日历、提醒事项、通知的权限。先让系统助手弹授权框（权限记在壳 App 名下），
// 助手不在或不会，就由壳按系统的设置地址打开那一页。

import { shell } from 'electron';
import type { DesktopPermission } from '../../../agent/shared/api/desktop-bridge.ts';
import type { HelperProcess } from '../helper/helper-process.ts';

const MAC: Readonly<Record<DesktopPermission, string>> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  calendar: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars',
  reminders: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders',
  notifications: 'x-apple.systempreferences:com.apple.preference.notifications',
};

const WINDOWS: Readonly<Partial<Record<DesktopPermission, string>>> = {
  notifications: 'ms-settings:notifications',
  calendar: 'ms-settings:privacy-calendar',
};

export function openPermission(platform: NodeJS.Platform, permission: DesktopPermission, helper: HelperProcess,
  log: (line: string) => void): void {
  const fallback = (): void => {
    const url = platform === 'darwin' ? MAC[permission] : platform === 'win32' ? WINDOWS[permission] : undefined;
    if (url !== undefined) {
      void shell.openExternal(url);
    }
  };
  if (permission === 'notifications') {
    fallback();
    return;
  }
  // 助手第一次弹系统授权框，拒过的打开「系统设置」那一页（permissions.request）。
  helper.call('permissions.request', { kind: permission }).catch((error: unknown) => {
    log(`助手没打开权限设置：${error instanceof Error ? error.message : String(error)}`);
    fallback();
  });
}
