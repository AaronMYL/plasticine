// 测试用的 systemctl（scripts/packages/linux-install.test.ts、linux-e2e.ts）：这台机器和 CI 容器里没有 systemd。
// 读 $PLASTICINE_PREFIX/etc/systemd/system 里 install.sh 装的单元文件，按 WorkingDirectory、Environment、
// EnvironmentFile、ExecStart 把服务真的起在后台（User= 不管，以当前用户跑），进程号记在 $FAKE_SYSTEMD_STATE。
// 只实现 install.sh、update.ts、plasticine-ctl.sh 用到的子命令。

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STOP_WAIT_MS = 10_000;
const POLL_MS = 50;

interface Unit {
  directory: string;
  env: Record<string, string>;
  command: string[];
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

/** systemd 的引号规则够用的子集：双引号包起来的算一个参数。 */
export function splitCommand(line: string): string[] {
  const parts: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|(\S+)/g)) {
    parts.push(match[1] ?? match[2] ?? '');
  }
  return parts;
}

export function parseUnit(text: string): Unit {
  const joined = text.replace(/\\\n\s*/g, ' ');
  const unit: Unit = { directory: '/', env: {}, command: [] };
  for (const line of joined.split('\n')) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=');
    if (key === 'WorkingDirectory') {
      unit.directory = value;
    } else if (key === 'Environment') {
      const [name, ...assigned] = value.split('=');
      unit.env[name ?? ''] = assigned.join('=');
    } else if (key === 'EnvironmentFile') {
      const path = value.replace(/^-/, '');
      if (existsSync(path)) {
        for (const entry of readFileSync(path, 'utf8').split('\n')) {
          const assignment = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(entry.trim());
          if (assignment?.[1] !== undefined) {
            unit.env[assignment[1]] = assignment[2] ?? '';
          }
        }
      }
    } else if (key === 'ExecStart') {
      unit.command = splitCommand(value);
    }
  }
  return unit;
}

function stateDirectory(): string {
  const state = process.env['FAKE_SYSTEMD_STATE'] ?? join(process.env['PLASTICINE_PREFIX'] ?? '', 'fake-systemd');
  mkdirSync(state, { recursive: true });
  return state;
}

function paths(name: string): { unit: string; pid: string; log: string } {
  const state = stateDirectory();
  return { unit: join(process.env['PLASTICINE_PREFIX'] ?? '', 'etc/systemd/system', name),
    pid: join(state, `${name}.pid`), log: join(state, `${name}.log`) };
}

function stop(name: string): void {
  const { pid: pidFile } = paths(name);
  if (!existsSync(pidFile)) {
    return;
  }
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (alive(pid)) {
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + STOP_WAIT_MS;
    while (alive(pid) && Date.now() < deadline) {
      sleep(POLL_MS);
    }
    if (alive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
  rmSync(pidFile, { force: true });
}

function start(name: string): void {
  if (!name.endsWith('.service') || name === 'plasticine-update.service') {
    return;
  }
  const { unit: unitFile, pid, log } = paths(name);
  const unit = parseUnit(readFileSync(unitFile, 'utf8'));
  const [program, ...args] = unit.command;
  if (program === undefined) {
    throw new Error(`${name} 没有 ExecStart`);
  }
  const output = openSync(log, 'a');
  const child = spawn(program, args, { cwd: unit.directory, detached: true,
    env: { PATH: process.env['PATH'] ?? '', ...unit.env }, stdio: ['ignore', output, output] });
  writeFileSync(pid, String(child.pid));
  child.unref();
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const now = rest.includes('--now');
  const units = rest.filter((item) => !item.startsWith('--'));
  appendFileSync(join(stateDirectory(), 'calls.log'), `${argv.join(' ')}\n`);
  switch (command) {
    case 'daemon-reload':
      return 0;
    case 'enable':
      units.forEach((unit) => (now ? start(unit) : undefined));
      return 0;
    case 'disable':
    case 'stop':
      units.forEach((unit) => (command === 'stop' || now ? stop(unit) : undefined));
      return 0;
    case 'start':
      units.forEach(start);
      return 0;
    case 'restart':
      units.forEach((unit) => {
        stop(unit);
        start(unit);
      });
      return 0;
    default:
      process.stderr.write(`fake systemctl 不认识 ${String(command)}\n`);
      return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
