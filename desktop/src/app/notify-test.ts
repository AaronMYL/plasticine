export interface NoticeLike {
  on(event: 'show', listener: () => void): unknown;
  on(event: 'failed', listener: (event: unknown, error: string) => void): unknown;
  show(): void;
}

export interface NotifyTestResult {
  shown: boolean;
  error: string | null;
}

export const NOTIFY_TEST_WAIT_MS = 4_000;

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
