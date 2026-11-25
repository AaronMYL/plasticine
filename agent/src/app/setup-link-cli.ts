import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_RELAY_URL, RelayClient } from '../../protocol/relay-client.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { openState } from '../state/index.ts';
import { DATABASE_FILE, DEFAULT_PORT } from './config.ts';
import { setupLink } from './setup-link-run.ts';

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
