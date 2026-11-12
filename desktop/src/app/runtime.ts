// 壳在真系统上要的几样小工具：日志、安装包里带的东西在哪（本体、Node、系统助手、构建出来的 preload 和注入脚本）、
// 拉起本体和助手、等健康检查、读网址、解 zip、拉起和自己脱钩的进程。开发和冒烟测试时可以用环境变量指到别处。

import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { net } from 'electron';
import { HelperUnavailable } from '../helper/helper-process.ts';
import { serverEnvironment } from './local-server.ts';
import { LOCAL_SERVER_URL } from './server-target.ts';

/** 日志超过 10 MB 换一份、只留上一份（和本体、Swift 版一样）。 */
const LOG_LIMIT = 10 * 1024 * 1024;
/** browser_read 最多读这么多（和 Mac 壳一样 200 KiB）。 */
const READ_URL_MAX = 200 * 1024;

function rotate(file: string): void {
  if (existsSync(file) && statSync(file).size > LOG_LIMIT) {
    renameSync(file, `${file}.1`);
  }
}

export function logger(directory: string): (line: string) => void {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'desktop.log');
  rotate(file);
  return (line) => {
    const entry = `${new Date().toISOString()} ${line}\n`;
    process.stdout.write(entry);
    appendFileSync(file, entry);
  };
}

export interface Resources {
  /** 构建出来的 preload、开始页、注入脚本（dist/）。 */
  dist: string;
  server: string | null;
  node: string | null;
  helper: string | null;
  icon: string;
  /** Mac 菜单栏图标（单色模板图；同目录的 @2x 由系统自己挑）。 */
  trayTemplate: string;
}

export function resources(input: { packaged: boolean; resourcesPath: string; dist: string;
  platform: NodeJS.Platform; env: NodeJS.ProcessEnv }): Resources {
  const base = input.packaged ? input.resourcesPath : join(input.dist, '..', 'resources-dev');
  const pick = (override: string | undefined, path: string): string | null => {
    const chosen = override ?? path;
    return existsSync(chosen) ? chosen : null;
  };
  const serverDir = pick(input.env.PLASTICINE_DESKTOP_SERVER, join(base, 'server'));
  // Mac：助手是壳 App 的附属可执行文件 Contents/MacOS/plasticine-helper（系统权限记在壳名下）；
  // Windows：resources/helper/PlasticineHelper.exe。
  const helper = input.platform === 'darwin' ? join(input.resourcesPath, '..', 'MacOS', 'plasticine-helper')
    : join(base, 'helper', 'PlasticineHelper.exe');
  return {
    dist: input.dist,
    server: serverDir !== null && existsSync(join(serverDir, 'manifest.json')) ? serverDir : null,
    node: pick(input.env.PLASTICINE_DESKTOP_NODE, join(base, 'node', input.platform === 'win32' ? 'node.exe' : 'node')),
    helper: pick(input.env.PLASTICINE_DESKTOP_HELPER, helper),
    icon: join(input.dist, 'icon.png'),
    trayTemplate: join(input.dist, 'trayTemplate.png'),
  };
}

export function launchServer(input: { node: string; server: string; state: string; logs: string;
  platform: NodeJS.Platform; localToken: string }): ChildProcess {
  mkdirSync(input.state, { recursive: true, mode: 0o700 });
  mkdirSync(input.logs, { recursive: true });
  const logFile = join(input.logs, 'server.log');
  rotate(logFile);
  const log = openSync(logFile, 'a', 0o600);
  return spawn(input.node, ['agent/src/app/main.ts'], { cwd: input.server, windowsHide: true,
    stdio: ['pipe', log, log], env: serverEnvironment({ platform: input.platform, serverDirectory: input.server,
      stateDirectory: input.state, base: process.env, join, localToken: input.localToken }) });
}

/** 本机本体在 timeoutMs 内答上 /v2/health。 */
export async function waitHealthy(timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal.aborted) {
    try {
      const response = await fetch(new URL('v2/health', LOCAL_SERVER_URL), { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return true;
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

export function spawnHelper(path: string | null): ChildProcessWithoutNullStreams {
  if (path === null) {
    throw new HelperUnavailable('这个安装包没有带系统助手（截屏、点按、文件、命令）。');
  }
  return spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

/** 和自己脱钩的进程（自更新的脚本：客户端退出后它接着跑）。 */
export function launchDetached(file: string, args: readonly string[]): void {
  const child = spawn(file, [...args], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export function runChecked(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${file} 退出码 ${code ?? '信号'}`))));
  });
}

/** onProgress：边下边报已下的字节数（更新包的圆形进度）；不给就一次读完。 */
export async function fetchBytes(url: string, onProgress?: (received: number) => void): Promise<Uint8Array> {
  const response = await net.fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`下载 ${new URL(url).pathname} 回了 ${response.status}`);
  }
  if (onProgress === undefined || response.body === null) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** browser_read：读网址的文字（HTML 保留标记），最多 200 KiB；不是已登录浏览器的 DOM。 */
export async function readUrl(url: string): Promise<{ text: string; truncated: boolean }> {
  const response = await net.fetch(url, { redirect: 'follow' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const truncated = bytes.length > READ_URL_MAX;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(truncated ? bytes.subarray(0, READ_URL_MAX) : bytes);
  return { text, truncated };
}
