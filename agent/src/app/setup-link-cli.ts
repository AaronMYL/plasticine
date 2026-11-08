// 打印一次性建账号链接（2026-11-08：Linux 服务器装完由 install.sh 调它；以后也能 plasticine setup-link 再拿一条）。
// 以 plasticine 用户运行：PLASTICINE_STATE=/var/lib/plasticine/state node agent/src/app/setup-link-cli.ts
// 还没有主人时生成令牌（30 分钟、用一次，库里只存 SHA-256），打印 http://127.0.0.1:<端口>/#/setup?t=<令牌>；
// 配了对外地址（PLASTICINE_PUBLIC_URL）或已经有 @账号的网址时另打一行。已经有主人就说一句，退出码 0。
// 链接打在终端上给装的人看，不进日志。

import { join } from 'node:path';
import { errorCategory, safeLog } from '../shared-log.ts';
import { openState, type StateService } from '../state/index.ts';
import { DATABASE_FILE, DEFAULT_PORT } from './config.ts';
import { issueSetupToken } from './setup-link.ts';
import { configuredPublicUrl, handlePublicUrl } from './public-url.ts';

function setupPath(token: string): string {
  return `/#/setup?t=${encodeURIComponent(token)}`;
}

/** 对外能打开的那个地址：配了 PLASTICINE_PUBLIC_URL 用它；不然有 @账号就用它的网址（app/public-url.ts）。 */
function networkBase(state: StateService, env: NodeJS.ProcessEnv): string | null {
  const configured = configuredPublicUrl(env);
  if (configured !== null) {
    return new URL(configured).origin;
  }
  const identity = state.networkIdentity.get();
  return identity === undefined ? null : handlePublicUrl(identity.handle, identity.relayUrl, env);
}

function main(): number {
  const env = process.env;
  const stateDir = env['PLASTICINE_STATE'];
  if (stateDir === undefined || stateDir === '') {
    safeLog('error', 'state_directory_required');
    return 2;
  }
  const port = Number(env['PLASTICINE_PORT'] ?? DEFAULT_PORT);
  const state = openState({ path: join(stateDir, DATABASE_FILE) });
  try {
    const issued = issueSetupToken(state, new Date());
    if (issued === null) {
      process.stdout.write('这份 Plasticine 已经有主人了：用 @账号和密码登录。忘了密码运行 plasticine password。\n');
      return 0;
    }
    const lines = ['在浏览器里打开这个链接建账号（30 分钟内有效，只能用一次）：',
      `  http://127.0.0.1:${port}${setupPath(issued.token)}`];
    const base = networkBase(state, env);
    if (base !== null) {
      lines.push(`  ${base}${setupPath(issued.token)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  } finally {
    state.close();
  }
}

try {
  process.exitCode = main();
} catch (error) {
  safeLog('error', 'setup_link_failed', { category: errorCategory(error) });
  process.exitCode = 1;
}
