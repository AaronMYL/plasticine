// 假的 /v2/system/operations：设置 · 系统里的运行情况（演示用的几样数）。

import type { SystemsApi } from '../systems-client.ts';
import type { SystemOperations } from '../shared.ts';
import type { FakeSession } from './fake-session.ts';

export class FakeSystems implements SystemsApi {
  private readonly session: FakeSession;

  constructor(session: FakeSession) {
    this.session = session;
  }

  async operations(): Promise<SystemOperations> {
    this.session.require();
    return { version: '本地演示', uptimeSeconds: 120,
      mail: { sentAt: null, sendError: null, receivedAt: null, receiveError: null }, scans: [],
      diskFreeBytes: 25 * 1024 ** 3, diskTotalBytes: 50 * 1024 ** 3, diskLow: false, backupAt: null,
      notifications: [] };
  }
}
