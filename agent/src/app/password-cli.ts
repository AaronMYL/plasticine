import { join } from 'node:path';
import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from '../../shared/api/account.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { openState } from '../state/index.ts';
import { DATABASE_FILE } from './config.ts';
import { hashPassword } from './password-hash.ts';
import { Cancelled, readHidden, readLine } from './cli-input.ts';

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
