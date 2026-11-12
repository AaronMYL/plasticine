// 打印一次性建账号链接（2026-11-08：Linux 服务器装完由 install.sh 调它；以后也能 plasticine setup-link 再拿一条）。
// 以 plasticine 用户运行：PLASTICINE_STATE=/var/lib/plasticine/state node agent/src/app/setup-link-cli.ts
//   [--handle <@账号>] [--domain <域名>]
// 做什么见 setup-link-run.ts。链接打在终端上给装的人看，不进日志。这次新加入了网络时退出码 10：install.sh 据此重启服务。

import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_RELAY_URL, RelayClient } from '../../protocol/relay-client.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { openState } from '../state/index.ts';
import { DATABASE_FILE, DEFAULT_PORT } from './config.ts';
import { setupLink } from './setup-link-run.ts';

/** 新加入了网络，要重启服务。 */
const JOINED_EXIT_CODE = 10;

async function main(): Promise<number> {
  const env = process.env;
  const stateDir = env['PLASTICINE_STATE'];
  if (stateDir === undefined || stateDir === '') {
    safeLog('error', 'state_directory_required');
    return 2;
  }
  const { values } = parseArgs({ options: { handle: { type: 'string' }, domain: { type: 'string' } } });
  const state = openState({ path: join(stateDir, DATABASE_FILE) });
  try {
    const relayUrl = env['PLASTICINE_NETWORK_URL'] === undefined || env['PLASTICINE_NETWORK_URL'] === ''
      ? DEFAULT_RELAY_URL : env['PLASTICINE_NETWORK_URL'];
    const result = await setupLink({ state, env, now: new Date(), port: Number(env['PLASTICINE_PORT'] ?? DEFAULT_PORT),
      relayUrl, client: (baseUrl) => new RelayClient({ baseUrl, now: () => new Date() }),
      ...(values.handle === undefined || values.handle === '' ? {} : { handle: values.handle }),
      ...(values.domain === undefined || values.domain === '' ? {} : { domain: values.domain }) });
    process.stdout.write(`${result.lines.join('\n')}\n`);
    return result.joined ? JOINED_EXIT_CODE : 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : '没做成。'}\n`);
    return 1;
  } finally {
    state.close();
  }
}

main().then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  safeLog('error', 'setup_link_failed', { category: errorCategory(error) });
  process.exitCode = 1;
});
