// Makes a one-time pairing code on the server (decision 90 ②). Run as the plasticine user:
//   PLASTICINE_STATE=/home/plasticine/state/agent node agent/src/app/pairing-cli.ts
// Prints the code and when it expires; only its hash is stored. The code works once, within 10 minutes. The
// service may be running: the library is shared through WAL and a short write lock.

import { join } from 'node:path';
import { errorCategory, safeLog } from '../shared-log.ts';
import { requireInteractiveTerminal, showAuthorization } from '../shared-terminal.ts';
import { openState } from '../state/index.ts';
import { DATABASE_FILE } from './config.ts';
import { issuePairingCode } from './pairing-code.ts';

function main(): number {
  const stateDir = process.env['PLASTICINE_STATE'];
  if (stateDir === undefined || stateDir === '') {
    safeLog('error', 'state_directory_required');
    return 2;
  }
  requireInteractiveTerminal();
  const state = openState({ path: join(stateDir, DATABASE_FILE) });
  try {
    const { code, expiresAt } = issuePairingCode(state, new Date());
    safeLog('log', 'pairing_created');
    showAuthorization('pairing', code, expiresAt);
    return 0;
  } finally {
    state.close();
  }
}

try {
  process.exitCode = main();
} catch (error) {
  safeLog('error', 'pairing_failed', { category: errorCategory(error) });
  process.exitCode = 1;
}
