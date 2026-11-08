// 在服务器上重设主人密码（2026-11-08：忘了密码，服务器实例运行 plasticine password）。以 plasticine 用户运行：
//   PLASTICINE_STATE=/var/lib/plasticine/state node agent/src/app/password-cli.ts            交互：输两遍，不回显
//   printf '%s\n' "$NEW" | PLASTICINE_STATE=… node agent/src/app/password-cli.ts --stdin    脚本：读一行
// 只存 scrypt 哈希；已经登录着的设备照旧（要退出某台在设备列表里点）。服务开着也能跑：库经 WAL 共享。

import { join } from 'node:path';
import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from '../../shared/api/account.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { openState } from '../state/index.ts';
import { DATABASE_FILE } from './config.ts';
import { hashPassword } from './password-hash.ts';

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u007f', '\b']);

class Cancelled extends Error {
  constructor() {
    super('取消了');
    this.name = 'Cancelled';
  }
}

/** 终端里读一行，不回显（raw 模式自己收字：回车结束、退格删一个字、Ctrl-C 取消）。 */
function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.setEncoding('utf8');
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error: Error | null): void => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write('\n');
      if (error === null) {
        resolve(value);
      } else {
        reject(error);
      }
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish(null);
          return;
        }
        if (char === CTRL_C || char === CTRL_D) {
          finish(new Cancelled());
          return;
        }
        if (BACKSPACE.has(char)) {
          value = Array.from(value).slice(0, -1).join('');
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    input.on('data', onData);
  });
}

async function readLine(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

function problem(password: string): string | null {
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_CHARS) {
    return `密码至少 ${PASSWORD_MIN_CHARS} 位。`;
  }
  return length > PASSWORD_MAX_CHARS ? `密码最多 ${PASSWORD_MAX_CHARS} 位。` : null;
}

async function newPassword(fromStdin: boolean): Promise<string | null> {
  if (fromStdin) {
    return readLine();
  }
  if (process.stdin.isTTY !== true) {
    process.stderr.write('要在终端里运行（输入不回显）；脚本里用 --stdin 从标准输入读一行。\n');
    return null;
  }
  const first = await readHidden('新密码：');
  const second = await readHidden('再输一遍：');
  if (first !== second) {
    process.stderr.write('两遍不一样，密码没改。\n');
    return null;
  }
  return first;
}

async function main(): Promise<number> {
  const stateDir = process.env['PLASTICINE_STATE'];
  if (stateDir === undefined || stateDir === '') {
    safeLog('error', 'state_directory_required');
    return 2;
  }
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--stdin')) {
    process.stderr.write('用法：password-cli.ts [--stdin]\n');
    return 2;
  }
  const password = await newPassword(args.includes('--stdin'));
  if (password === null) {
    return 1;
  }
  const wrong = problem(password);
  if (wrong !== null) {
    process.stderr.write(`${wrong}密码没改。\n`);
    return 1;
  }
  const { hash, salt } = await hashPassword(password);
  const state = openState({ path: join(stateDir, DATABASE_FILE) });
  try {
    state.ownerAccount.setPassword(hash, salt, new Date().toISOString());
  } finally {
    state.close();
  }
  process.stdout.write('密码改好了。已经登录着的设备照旧；要让某台退出，在「设置 · 设备」里点它。\n');
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof Cancelled) {
    process.exitCode = 130;
  } else {
    safeLog('error', 'password_reset_failed', { category: errorCategory(error) });
    process.exitCode = 1;
  }
}
