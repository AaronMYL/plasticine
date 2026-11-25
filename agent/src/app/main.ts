import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { errorCategory, safeLog } from '../util/index.ts';
import { loadOrCreateVapidKeys } from '../attention/index.ts';
import { NOTES_DIRECTORY, openState } from '../state/index.ts';
import { assembleApp } from './assemble.ts';
import { createGmailTransports, CredentialFiles, CREDENTIALS_DIRECTORY } from '../cloud-tools/index.ts';
import { FeedFetcher } from '../daily/index.ts';
import { DATABASE_FILE, DEFAULT_PORT, DEFAULT_VAPID_SUBJECT, HOST } from './config.ts';
import { MAINTENANCE_SOCKET_FILE } from '../../shared/api/maintenance.ts';
import { LOCAL_TOKEN_ENV } from '../../shared/api/account.ts';
import { openMaintenanceSocket } from './maintenance-socket.ts';
import { stopOnStdinEof, stopSignal } from './stop-signal.ts';
import { KernelModels, ProviderLogins } from '../kernel/index.ts';
import { createCompactor } from '../lines/index.ts';
import { applyPendingMigration, MigrationService, RESTART_EXIT_CODE } from '../system/index.ts';

interface Settings {
  stateDir: string;
  port: number;
  dryRun: boolean;
  vapidSubject: string;
}

const MAX_PORT = 65_535;

function settings(env: NodeJS.ProcessEnv): Settings | string {
  const stateDir = env['PLASTICINE_STATE'];
  if (stateDir === undefined || stateDir === '') {
    return '需要设置 PLASTICINE_STATE（plasticine 用户的状态目录）。';
  }
  const portText = env['PLASTICINE_PORT'] ?? String(DEFAULT_PORT);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    return `PLASTICINE_PORT=${portText} 不是有效端口。`;
  }
  const vapidSubject = env['PLASTICINE_VAPID_SUBJECT'] ?? DEFAULT_VAPID_SUBJECT;
  if (!/^(https:\/\/|mailto:)/.test(vapidSubject)) {
    return 'PLASTICINE_VAPID_SUBJECT 要是 https:// 地址或 mailto:（RFC 8292）。';
  }
  return { stateDir, port, dryRun: env['PLASTICINE_DRY_RUN'] !== '0', vapidSubject };
}

function networkSettings(env: NodeJS.ProcessEnv): NonNullable<Parameters<typeof assembleApp>[0]['network']> {
  const relayUrl = env['PLASTICINE_NETWORK_URL'];
  const acmeDirectory = env['PLASTICINE_ACME_DIRECTORY'];
  return {
    ...(relayUrl === undefined || relayUrl === '' ? {} : { relayUrl }),
    ...(env['PLASTICINE_TUNNEL'] === '0' ? {} : { tunnel: acmeDirectory === undefined || acmeDirectory === ''
      ? {} : { acmeDirectory } }),
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

async function main(): Promise<number> {
  const config = settings(process.env);
  if (typeof config === 'string') {
    safeLog('error', 'startup_invalid');
    return 2;
  }
  if (existsSync(join(config.stateDir, 'restore-review.json'))) {
    safeLog('error', 'restore_review_required');
    return 2;
  }
  try {
    if (applyPendingMigration(config.stateDir, () => new Date()) !== null) {
      safeLog('log', 'migration_applied');
    }
  } catch (error) {
    safeLog('error', 'migration_apply_failed', { category: errorCategory(error) });
  }
  const state = openState({
    path: join(config.stateDir, DATABASE_FILE),
    notesDirectory: join(config.stateDir, NOTES_DIRECTORY),
    enforceBackupOwner: process.platform === 'linux',
  });
  try {
    const vapidKeys = await loadOrCreateVapidKeys(config.stateDir);
    const kernelModels = new KernelModels({ state });
    const stopAccountModels = await kernelModels.startAccountModels();
    const kernelLogins = new ProviderLogins(kernelModels);
    if (kernelModels.effective() === null) {
      safeLog('warn', 'login_required');
    }
    const clientDirectory = nonEmpty(process.env['PLASTICINE_CLIENT_DIR']);
    const clientManifestPath = process.env['PLASTICINE_CLIENT_MANIFEST']
      ?? (clientDirectory === undefined ? '/var/www/plasticine/current/client-manifest.json'
        : join(clientDirectory, 'client-manifest.json'));
    let restart: () => void = () => undefined;
    const restarting = new Promise<string>((resolve) => {
      restart = () => resolve('migration');
    });
    const migration = new MigrationService({ stateDirectory: config.stateDir, now: () => new Date(),
      snapshot: (path) => state.snapshotTo(path), restart: () => restart() });
    const app = assembleApp({
      state,
      migration,
      dryRun: config.dryRun,
      vapidKeys,
      vapidSubject: config.vapidSubject,
      stateDirectory: config.stateDir,
      clientManifestPath,
      ...(clientDirectory === undefined ? {} : { clientDirectory }),
      cloudTransports: createGmailTransports({
        credentials: new CredentialFiles(join(config.stateDir, CREDENTIALS_DIRECTORY)),
      }),
      feedFetcher: new FeedFetcher(),
      lines: { models: kernelModels,
        compact: createCompactor({ state, models: kernelModels, now: () => new Date() }) },
      kernelModels: { models: kernelModels, logins: kernelLogins },
      network: networkSettings(process.env),
      localToken: nonEmpty(process.env[LOCAL_TOKEN_ENV]) ?? null,
    });
    app.start();
    const port = await app.listen(config.port, HOST);
    safeLog('log', 'service_started', { counts: { port } });
    const maintenance = await openMaintenanceSocket(join(config.stateDir, MAINTENANCE_SOCKET_FILE), app.deps)
      .catch((error: unknown) => {
        safeLog('warn', 'maintenance_socket_failed', { category: errorCategory(error) });
        return undefined;
      });
    const reason = await Promise.race([restarting,
      stopSignal({ process, ...(stopOnStdinEof(process.env) ? { stdin: process.stdin } : {}) })]);
    safeLog('log', 'service_stopping');
    stopAccountModels();
    await maintenance?.close();
    await app.stop();
    return reason === 'migration' ? RESTART_EXIT_CODE : 0;
  } finally {
    state.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  safeLog('error', 'startup_failed', { category: errorCategory(error) });
  process.exitCode = 1;
}
