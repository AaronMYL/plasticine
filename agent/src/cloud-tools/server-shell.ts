import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ShellInvocation {
  command: string;
  args: string[];
  detached: boolean;
}

const POWERSHELL_PRELUDE = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '',
].join('\n');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const TASKKILL_NOT_FOUND = 128;

export function shellFor(script: string, directory: string, platform: NodeJS.Platform = process.platform):
  ShellInvocation {
  if (platform === 'win32') {
    const file = join(directory, 'script.ps1');
    writeFileSync(file, Buffer.concat([UTF8_BOM, Buffer.from(`${POWERSHELL_PRELUDE}${script}\n`, 'utf8')]),
      { mode: 0o600 });
    return { command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      detached: false };
  }
  return { command: '/bin/bash', args: ['--noprofile', '--norc', '-c', script], detached: true };
}

export interface KillTools {
  kill?: (pid: number, signal: NodeJS.Signals) => boolean;
  run?: (command: string, args: string[]) => { status: number | null };
}

export function killProcessTree(pid: number, platform: NodeJS.Platform = process.platform,
  tools: KillTools = {}): void {
  if (platform === 'win32') {
    const run = tools.run ?? ((command: string, args: string[]) => spawnSync(command, args, { windowsHide: true }));
    const result = run('taskkill', ['/pid', String(pid), '/T', '/F']);
    if (result.status !== 0 && result.status !== TASKKILL_NOT_FOUND) {
      throw new Error(`taskkill 没能结束进程 ${pid}（退出码 ${String(result.status)}）`);
    }
    return;
  }
  const kill = tools.kill ?? ((target: number, signal: NodeJS.Signals) => process.kill(target, signal));
  try {
    kill(-pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
      throw error;
    }
  }
}
