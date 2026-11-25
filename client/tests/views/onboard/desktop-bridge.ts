import { vi, type Mock } from 'vitest';
import type { HostProfile } from '../../../src/api/shared.ts';
import { FAKE_LOCAL_TOKEN } from '../../../src/api/fake/fake-account.ts';

export interface FakeDesktop {
  showWelcome: Mock<() => void>;
  open: Mock<(url: string) => void>;
  capture: Mock<(port: number, timeoutMs: number) => Promise<string | null>>;
  cancelCapture: Mock<() => void>;
}

export function installDesktop(options: { localToken?: string | null; captured?: string | null;
  profile?: HostProfile | null } = {}): FakeDesktop {
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
    server: { localGrant: async () => token, showWelcome: desktop.showWelcome,
      profile: async () => options.profile ?? null },
    external: { open: desktop.open, capture: desktop.capture, cancelCapture: desktop.cancelCapture },
  } });
  return desktop;
}

export function removeDesktop(): void {
  Reflect.deleteProperty(window, 'plasticineDesktop');
}
