// Starts the service. Run by systemd as the plasticine user (agent/deploy/plasticine-app.service):
//   PLASTICINE_STATE=/home/plasticine/state/agent node agent/src/app/main.ts
// Environment: PLASTICINE_STATE (required: holds plasticine.sqlite, notes/, books/, files/, the Web Push VAPID key file),
// PLASTICINE_PORT (default 8790), PLASTICINE_DRY_RUN (`0` turns the development dry run off, decision 8),
// PLASTICINE_VAPID_SUBJECT (the contact push services see; default the site's address),
// PLASTICINE_NETWORK_URL (the Cyber Hunter relay this instance talks to, decision 113; default https://cyberhunter.top;
// the relay is its own service since 2026-11-05 and not part of this repository), PLASTICINE_TUNNEL (`0` leaves out the
// <handle>.cyberhunter.top tunnel: for an instance that shares the host with the relay and is served by Caddy),
// PLASTICINE_ACME_DIRECTORY (the ACME directory for the tunnel certificate; default Let's Encrypt).
// Install packages (docs/install-packages.md): PLASTICINE_CLIENT_DIR (serve the client build from here, there is no
// Caddy; the client manifest defaults to its client-manifest.json), PLASTICINE_STOP_ON_STDIN_EOF (`1`: the Mac App or
// the Windows tray owns this process and closes stdin to stop it).
// 2026-11-05 Harness 重做：模型都在库里（设置 · AI 登录或填 key，kernel/），不再从环境变量选模型和推理档。
// Start-up order: recovery (uploads, devices, payment reads, memory curation) → network → tunnel → lines → backups →
// scans → listen. On SIGTERM / SIGINT: stop taking requests, stop the lines (they resume after the restart), close the
// library.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { errorCategory, safeLog } from '../shared-log.ts';
import { loadOrCreateVapidKeys } from '../attention/index.ts';
import { NOTES_DIRECTORY, openState } from '../state/index.ts';
import { assembleApp } from './assemble.ts';
import { createGmailTransports, CredentialFiles, CREDENTIALS_DIRECTORY } from '../cloud-tools/index.ts';
import { FeedFetcher } from '../daily/index.ts';
import { DATABASE_FILE, DEFAULT_PORT, DEFAULT_VAPID_SUBJECT, HOST } from './config.ts';
import { MAINTENANCE_SOCKET_FILE } from '../../shared/api/maintenance.ts';
import { openMaintenanceSocket } from './maintenance-socket.ts';
import { stopOnStdinEof, stopSignal } from './stop-signal.ts';
import { KernelModels, ProviderLogins } from '../kernel/index.ts';
import { createCompactor } from '../lines/index.ts';

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

/** 第 113 条和 2026-11-05 的隧道：中继地址、装不装隧道、隧道证书找哪个 ACME。 */
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
  const state = openState({
    path: join(config.stateDir, DATABASE_FILE),
    notesDirectory: join(config.stateDir, NOTES_DIRECTORY),
    // 备份目录要求 Linux 的 plasticine 用户（自己的 Linux 服务器、Linux 安装包都是）；Mac / Windows 安装包以登录用户运行。
    enforceBackupOwner: process.platform === 'linux',
  });
  try {
    const vapidKeys = await loadOrCreateVapidKeys(config.stateDir);
    // 新内核（2026-11-05 Harness 重做）：线和它的模型连接。凭证在库里，提供商一律平级。
    const kernelModels = new KernelModels({ state });
    const kernelLogins = new ProviderLogins(kernelModels);
    if (kernelModels.effective() === null) {
      safeLog('warn', 'login_required');
    }
    const clientDirectory = nonEmpty(process.env['PLASTICINE_CLIENT_DIR']);
    const clientManifestPath = process.env['PLASTICINE_CLIENT_MANIFEST']
      ?? (clientDirectory === undefined ? '/var/www/plasticine/current/client-manifest.json'
        : join(clientDirectory, 'client-manifest.json'));
    const app = assembleApp({
      state,
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
    });
    app.start();
    const port = await app.listen(config.port, HOST);
    safeLog('log', 'service_started', { counts: { port } });
    // 第 115 条：长期维护入口（本机 socket）。开不起来不影响服务，记一条日志。
    const maintenance = await openMaintenanceSocket(join(config.stateDir, MAINTENANCE_SOCKET_FILE), app.deps)
      .catch((error: unknown) => {
        safeLog('warn', 'maintenance_socket_failed', { category: errorCategory(error) });
        return undefined;
      });
    await stopSignal({ process, ...(stopOnStdinEof(process.env) ? { stdin: process.stdin } : {}) });
    safeLog('log', 'service_stopping');
    await maintenance?.close();
    await app.stop();
    return 0;
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
