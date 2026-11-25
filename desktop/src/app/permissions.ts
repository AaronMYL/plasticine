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
  helper.call('permissions.request', { kind: permission }).catch((error: unknown) => {
    log(`助手没打开权限设置：${error instanceof Error ? error.message : String(error)}`);
    fallback();
  });
}
