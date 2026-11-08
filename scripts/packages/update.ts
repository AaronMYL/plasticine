// Linux 安装包的更新命令（plasticine-update.service 每天跑；也可以手动跑）：
//   node update.ts update   --root /opt/plasticine --restart-command "systemctl restart plasticine.service"
//   node update.ts rollback --root /opt/plasticine --restart-command "systemctl restart plasticine.service"
//   node update.ts status   --root /opt/plasticine
// 发布点默认读当前版本 manifest.json 的 releaseUrl；PLASTICINE_RELEASE_URL / --release-url 可以改。
// 端口读 PLASTICINE_PORT（/etc/plasticine/plasticine.env），默认 8790。

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { rollback, status, update, type UpdaterDeps, type UpdateOptions } from './updater.ts';

const execute = promisify(execFile);
const DEFAULT_PORT = 8790;
// 下载一个几十 MB 的包；GitHub 偶尔慢，给足时间。
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
// 服务启动要开库、补跑重启前的任务，一分钟足够。
// PLASTICINE_HEALTH_SECONDS 可以改（测试里装坏版本时不用干等一分钟）。
const DEFAULT_HEALTH_SECONDS = 60;
const HEALTH_POLL_MS = 1000;

async function fetchBytes(url: URL): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    return readFile(fileURLToPath(url));
  }
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`下载 ${url.href} 失败：HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function healthy(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v2/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && ((await response.json()) as { ok?: unknown }).ok === true) {
        return true;
      }
    } catch (error) {
      // 服务还没起来（连接被拒、超时）：接着等，到点算不健康；最后一次的原因记一句。
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  console.error(`健康检查 ${timeoutMs / 1000} 秒没通过${lastFailure === '' ? '' : `：${lastFailure}`}`);
  return false;
}

export const realDeps: UpdaterDeps = {
  fetchBytes,
  async extract(archive, into) {
    await execute('tar', ['-xzf', archive, '-C', into, '--strip-components=1', '--no-same-owner']);
  },
  async restart(command) {
    const [program, ...args] = command;
    if (program === undefined) {
      return 1;
    }
    try {
      await execute(program, args);
      return 0;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'number' ? code : 1;
    }
  },
  healthy,
  now: () => new Date(),
  log: (line) => console.error(line),
  nodeVersion: process.version,
};

function options(values: { root?: string; 'release-url'?: string; 'restart-command'?: string; port?: string }):
  UpdateOptions {
  if (values.root === undefined) {
    throw new Error('要给 --root（安装目录，Linux 上是 /opt/plasticine）。');
  }
  const releaseUrl = values['release-url'] ?? process.env['PLASTICINE_RELEASE_URL'];
  const portText = values.port ?? process.env['PLASTICINE_PORT'] ?? String(DEFAULT_PORT);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`端口 ${portText} 无效。`);
  }
  const restart = values['restart-command']?.split(/\s+/).filter((part) => part !== '');
  const seconds = Number(process.env['PLASTICINE_HEALTH_SECONDS'] ?? DEFAULT_HEALTH_SECONDS);
  const healthTimeoutMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_HEALTH_SECONDS) * 1000;
  return { root: values.root, port, healthTimeoutMs,
    ...(releaseUrl === undefined || releaseUrl === '' ? {} : { releaseUrl }),
    ...(restart === undefined || restart.length === 0 ? {} : { restartCommand: restart }) };
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    root: { type: 'string' },
    'release-url': { type: 'string' },
    'restart-command': { type: 'string' },
    port: { type: 'string' },
  } });
  const command = positionals[0];
  if (command === 'status') {
    console.log(JSON.stringify(status(options(values).root), null, 2));
    return 0;
  }
  if (command === 'update') {
    const outcome = await update(options(values), realDeps);
    console.log(JSON.stringify(outcome));
    return outcome.kind === 'rolled_back' ? 1 : 0;
  }
  if (command === 'rollback') {
    const outcome = await rollback(options(values), realDeps);
    console.log(JSON.stringify(outcome));
    return outcome.healthy ? 0 : 1;
  }
  console.error('用法：node update.ts update|rollback|status --root <安装目录>');
  return 2;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
