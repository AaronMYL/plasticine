// desktop 测试共用：拉起假助手、临时目录。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE_HELPER = fileURLToPath(new URL('./fixtures/fake-helper.ts', import.meta.url));

export function spawnFakeHelper(mode = ''): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [FAKE_HELPER], { env: { ...process.env, FAKE_HELPER_MODE: mode } });
}

export function tempDir(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'plasticine-desktop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
