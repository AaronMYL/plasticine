// 服务器命令用哪个 shell、怎么连子进程一起结束。Linux 服务器和 Linux / Mac 安装包是 bash + 进程组；
// Windows 安装包（docs/install-packages.md）是 PowerShell，没有进程组，用 taskkill /T 结束整棵进程树。

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ShellInvocation {
  command: string;
  args: string[];
  /** POSIX 上自成进程组（kill(-pid) 整组结束）；Windows 上 detached 会另开控制台窗口，不用。 */
  detached: boolean;
}

// Windows PowerShell 5.1 往管道里写的是本地代码页，中文会乱；脚本开头改成 UTF-8。
const POWERSHELL_PRELUDE = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OutputEncoding = [System.Text.Encoding]::UTF8',
  '',
].join('\n');
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
// taskkill 找不到进程（已经结束）时的退出码。
const TASKKILL_NOT_FOUND = 128;

/**
 * 这段脚本怎么跑。Windows 上把脚本写成动作目录里的 script.ps1 再 -File 运行：命令行最长 32767 个字符，
 * 放不下 6 万字的脚本，也省掉命令行引号转义。
 */
export function shellFor(script: string, directory: string, platform: NodeJS.Platform = process.platform):
  ShellInvocation {
  if (platform === 'win32') {
    const file = join(directory, 'script.ps1');
    // 带 BOM：5.1 没有 BOM 时按本地代码页读脚本，中文路径和字符串会坏。
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

/** 结束这条命令和它开的子进程；进程已经没了不算错，别的失败带上原因抛出。 */
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
