// 设置 · 通用 · 通知「发一条测试通知」（第13批，11-14：Aaron 的 Mac 从没收到过通知，查下来是「系统设置 › 通知」里
// Plasticine 关着）。弹一条，等系统回话：弹出来了、系统拒了（Electron 42 起 macOS 用 UNNotification，不让发会触发
// failed，带原因）、几秒没回话，各说一句；界面照这句提示他去哪打开。

export interface NoticeLike {
  on(event: 'show', listener: () => void): unknown;
  on(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
  show(): void;
}

export interface NotifyTestResult {
  shown: boolean;
  error: string | null;
}

/** 系统多久不回话就当没弹出来。 */
export const NOTIFY_TEST_WAIT_MS = 4_000;

/** 各系统的通知设置页（界面上「打开系统设置」）。 */
export const NOTIFICATION_SETTINGS_URLS: Readonly<Record<string, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
  win32: 'ms-settings:notifications',
};

export function testNotice(create: () => NoticeLike, options: { supported: boolean; enabled: boolean;
  waitMs?: number }): Promise<NotifyTestResult> {
  if (!options.supported) return Promise.resolve({ shown: false, error: '这台电脑不支持系统通知。' });
  if (!options.enabled) {
    return Promise.resolve({ shown: false, error: 'Plasticine 自己的「系统通知」开关关着：在设置 · 系统里打开。' });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: NotifyTestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ shown: false,
      error: '系统没有回话：去系统的通知设置里看 Plasticine 是不是允许通知。' }), options.waitMs ?? NOTIFY_TEST_WAIT_MS);
    const notice = create();
    notice.on('show', () => finish({ shown: true, error: null }));
    notice.on('failed', (_event, error) => finish({ shown: false,
      error: `系统没让 Plasticine 发通知（${error}）：去系统的通知设置里找到 Plasticine，把「允许通知」打开。` }));
    notice.show();
  });
}
