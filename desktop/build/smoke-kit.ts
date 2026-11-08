// 桌面客户端冒烟（smoke.ts、smoke-onboard.ts）共用的小工具：空闲端口、等一件事、调试目标、截图、停进程。

import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { Cdp } from '../../scripts/browser/cdp.ts';

export const DESKTOP = fileURLToPath(new URL('..', import.meta.url));
export const ROOT = join(DESKTOP, '..');
export const ELECTRON = join(DESKTOP, 'node_modules', 'electron', 'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron');
/** SMOKE_APP 指向打好的安装包里的可执行文件时，冒烟跑那个（electron-builder --linux dir 的 linux-unpacked）。 */
export const PACKAGED = process.env.SMOKE_APP ?? null;
const STEP_TIMEOUT_MS = 60_000;

export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

export async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>): Promise<T> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null && value !== undefined && value !== false) {
        return value;
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
    await pause(500);
  }
  throw new Error(`等了 ${STEP_TIMEOUT_MS / 1000} 秒还没有：${what}`);
}

export async function targets(port: number): Promise<{ url: string; type: string; webSocketDebuggerUrl: string }[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return await response.json() as { url: string; type: string; webSocketDebuggerUrl: string }[];
}

/** 整屏截图（xvfb 的根窗口）。 */
export function shoot(directory: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('import', ['-window', 'root', join(directory, `${name}.png`)], { stdio: 'ignore' });
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`截图没成（${code}）`))));
  });
}

/** 只截这一页（调试协议），和设计稿一样是 1440 × 900 的窗口内容。 */
export async function shootPage(page: Cdp, directory: string, name: string): Promise<void> {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(directory, `${name}.png`), Buffer.from(String(shot['data']), 'base64'));
}

export function stop(child: ChildProcess | null): void {
  if (child !== null && child.exitCode === null) {
    child.kill('SIGTERM');
  }
}
