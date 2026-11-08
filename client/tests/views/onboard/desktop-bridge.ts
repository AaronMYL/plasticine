// 测试用的桌面客户端桥（agent/shared/api/desktop-bridge.ts 里首次使用流程用到的几样）：本机令牌、回开始页、
// 系统浏览器和本机等回调。装上 / 摘下都在这里，测完摘掉，别的测试照旧是普通网页。

import { vi, type Mock } from 'vitest';
import { FAKE_LOCAL_TOKEN } from '../../../src/api/fake/fake-account.ts';

export interface FakeDesktop {
  showWelcome: Mock<() => void>;
  open: Mock<(url: string) => void>;
  capture: Mock<(port: number, timeoutMs: number) => Promise<string | null>>;
  cancelCapture: Mock<() => void>;
}

export function installDesktop(options: { localToken?: string | null; captured?: string | null } = {}): FakeDesktop {
  const token = options.localToken === undefined ? FAKE_LOCAL_TOKEN : options.localToken;
  const desktop: FakeDesktop = {
    showWelcome: vi.fn(),
    open: vi.fn(),
    capture: vi.fn(async () => options.captured ?? null),
    cancelCapture: vi.fn(),
  };
  Object.assign(window, { plasticineDesktop: {
    version: '0.0.0',
    notify: vi.fn(),
    server: { localGrant: async () => token, showWelcome: desktop.showWelcome },
    external: { open: desktop.open, capture: desktop.capture, cancelCapture: desktop.cancelCapture },
  } });
  return desktop;
}

export function removeDesktop(): void {
  Reflect.deleteProperty(window, 'plasticineDesktop');
}
