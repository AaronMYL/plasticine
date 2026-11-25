import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { net } from 'electron';
import { NODE_LOG_TEXT_MAX } from '../../../agent/shared/api/devices.ts';
import { HelperUnavailable } from '../helper/helper-process.ts';
import { serverEnvironment } from './local-server.ts';
import { LOCAL_SERVER_URL } from './server-target.ts';

const LOG_LIMIT = 10 * 1024 * 1024;
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

const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (.*)$/;
const LOG_TEXT_MAX = NODE_LOG_TEXT_MAX;

export function logsSince(directory: string, since: string, max: number)
  : { lines: { at: string; text: string }[]; truncated: boolean } {
  const lines: { at: string; text: string }[] = [];
  for (const name of ['desktop.log.1', 'desktop.log']) {
    const file = join(directory, name);
    if (!existsSync(file)) {
      continue;
    }
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const match = LOG_LINE.exec(raw);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        lines.push({ at: match[1], text: match[2].slice(0, LOG_TEXT_MAX) });
      } else if (raw.trim() !== '' && lines.length > 0) {
        const last = lines[lines.length - 1]!;
        last.text = `${last.text}\n${raw}`.slice(0, LOG_TEXT_MAX);
      }
    }
  }
  const after = lines.filter((line) => line.at >= since);
  return { lines: after.slice(-max), truncated: after.length > max };
}

export interface Resources {
  dist: string;
  server: string | null;
  node: string | null;
  helper: string | null;
  icon: string;
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

export async function readUrl(url: string): Promise<{ text: string; truncated: boolean }> {
  const response = await net.fetch(url, { redirect: 'follow' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const truncated = bytes.length > READ_URL_MAX;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(truncated ? bytes.subarray(0, READ_URL_MAX) : bytes);
  return { text, truncated };
}
