// Linux 安装包的试装场地（没有 docker / systemd 时用；docs/install-packages.md「怎么验证」）：
// 一个临时前缀（PLASTICINE_PREFIX）、PATH 最前面一组假的 systemctl / useradd / chown / id、
// 一个本机文件做的 Node 下载镜像和发布点。install.sh、update.ts、plasticine 命令都照原样跑。

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256Hex, type ReleaseManifest } from '../release-manifest.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PACKAGES = join(HERE, '..');
const NODE_VERSION = process.version.replace(/^v/, '');

export interface Sandbox {
  root: string;
  prefix: string;
  release: string;
  port: number;
  systemdState: string;
  env: NodeJS.ProcessEnv;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
    });
  });
}

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function fakeCommands(bin: string, root: string): void {
  mkdirSync(bin, { recursive: true });
  const marker = join(root, 'user-plasticine');
  script(join(bin, 'systemctl'), `exec "${process.execPath}" "${join(HERE, 'fake-systemctl.ts')}" "$@"`);
  script(join(bin, 'useradd'), `touch "${marker}"`);
  script(join(bin, 'userdel'), `rm -f "${marker}"`);
  script(join(bin, 'chown'), 'exit 0');
  script(join(bin, 'journalctl'), 'exit 0');
  // 场地里当自己是 root（plasticine 命令要 root 才切到 plasticine 用户）；runuser 直接跑后面的命令。
  script(join(bin, 'id'), [`if [ "$1" = plasticine ]; then test -f "${marker}";`,
    'elif [ "$1" = -u ]; then echo 0;', 'else exec /usr/bin/id "$@"; fi'].join(' '));
  script(join(bin, 'runuser'), 'shift 3\nexec "$@"');
}

/** 用正在跑的这个 Node 做一份「nodejs.org」：bin/node 是一行转发脚本，SHASUMS256.txt 照真的格式写。 */
function nodeMirror(mirror: string): void {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const name = `node-v${NODE_VERSION}-linux-${arch}`;
  const staged = join(mirror, 'stage', name, 'bin');
  mkdirSync(staged, { recursive: true });
  script(join(staged, 'node'), `exec "${process.execPath}" "$@"`);
  const versionDir = join(mirror, `v${NODE_VERSION}`);
  mkdirSync(versionDir, { recursive: true });
  const tarball = join(versionDir, `${name}.tar.gz`);
  execFileSync('tar', ['-czf', tarball, '-C', join(mirror, 'stage'), name]);
  writeFileSync(join(versionDir, 'SHASUMS256.txt'), `${sha256Hex(readFileSync(tarball))}  ${name}.tar.gz\n`);
  rmSync(join(mirror, 'stage'), { recursive: true, force: true });
}

export async function createSandbox(): Promise<Sandbox> {
  const root = mkdtempSync(join(tmpdir(), 'plasticine-linux-'));
  const prefix = join(root, 'prefix');
  const bin = join(root, 'bin');
  const mirror = join(root, 'node-mirror');
  const release = join(root, 'release');
  const systemdState = join(root, 'systemd');
  mkdirSync(release, { recursive: true });
  fakeCommands(bin, root);
  nodeMirror(mirror);
  const port = await freePort();
  return { root, prefix, release, port, systemdState, env: {
    ...process.env,
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    PLASTICINE_PREFIX: prefix,
    PLASTICINE_RELEASE_URL: pathToFileURL(release).href,
    PLASTICINE_NODE_MIRROR: pathToFileURL(mirror).href,
    PLASTICINE_NODE_VERSION: NODE_VERSION,
    PLASTICINE_PORT: String(port),
    FAKE_SYSTEMD_STATE: systemdState,
    // 坏版本的健康检查不用干等一分钟。
    PLASTICINE_HEALTH_SECONDS: '8',
  } };
}

/** 把一个解开的服务包目录发到场地的发布点（tar.gz + manifest.json + install.sh）。 */
export function publish(sandbox: Sandbox, packageDir: string, version: string): void {
  const name = `plasticine-server-${version}.tar.gz`;
  const tarball = join(sandbox.release, name);
  const stage = join(sandbox.root, `stage-${version}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage);
  execFileSync('cp', ['-a', packageDir, join(stage, 'plasticine-server')]);
  execFileSync('tar', ['-czf', tarball, '-C', stage, 'plasticine-server']);
  rmSync(stage, { recursive: true, force: true });
  const installer = join(sandbox.release, 'install.sh');
  copyFileSync(join(PACKAGES, 'linux', 'install.sh'), installer);
  const asset = (file: string, assetName: string) => {
    const bytes = readFileSync(file);
    return { name: assetName, url: assetName, sha256: sha256Hex(bytes), size: bytes.length };
  };
  const manifest: ReleaseManifest = { schema: 1, version, commit: 'c'.repeat(40),
    publishedAt: new Date().toISOString(), nodeVersion: NODE_VERSION,
    assets: { server: asset(tarball, name), linuxInstaller: asset(installer, 'install.sh') } };
  writeFileSync(join(sandbox.release, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

/** 跑一条命令，stdout 和 stderr 合在一起返回（install.sh 的话都写在 stderr）。 */
export function run(sandbox: Pick<Sandbox, 'env'>, command: string, args: string[]): { code: number; output: string } {
  const result = spawnSync(command, args, { env: sandbox.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

async function healthOnce(port: number): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v2/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.json() as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** 健康检查的回答；服务刚重启时启动扫描会占住事件循环几秒，等到 `waitMs` 为止。 */
export async function health(sandbox: Sandbox, waitMs = 15_000): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const answer = await healthOnce(sandbox.port);
    if (answer !== null || Date.now() >= deadline) {
      return answer;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** 停掉假 systemd 起的进程，删掉场地。 */
export function destroy(sandbox: Sandbox): void {
  if (existsSync(sandbox.systemdState)) {
    for (const entry of readdirSync(sandbox.systemdState)) {
      if (entry.endsWith('.pid')) {
        const pid = Number(readFileSync(join(sandbox.systemdState, entry), 'utf8'));
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
          }
        }
      }
    }
  }
  rmSync(sandbox.root, { recursive: true, force: true });
}

/** 一个最小的「服务包」：真的更新器和单元文件 + 一个只答健康检查的 main.ts。broken 时一启动就退出。 */
export function fakeServerPackage(directory: string, version: string, options: { broken?: boolean } = {}): void {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(join(directory, 'agent/src/app'), { recursive: true });
  mkdirSync(join(directory, 'agent/shared'), { recursive: true });
  mkdirSync(join(directory, 'scripts/packages/linux'), { recursive: true });
  copyFileSync(join(PACKAGES, '../../agent/shared/release-manifest.ts'),
    join(directory, 'agent/shared/release-manifest.ts'));
  for (const file of ['release-manifest.ts', 'install-layout.ts', 'updater.ts', 'update.ts']) {
    copyFileSync(join(PACKAGES, file), join(directory, 'scripts/packages', file));
  }
  for (const file of readdirSync(join(PACKAGES, 'linux'))) {
    copyFileSync(join(PACKAGES, 'linux', file), join(directory, 'scripts/packages/linux', file));
  }
  execFileSync('ln', ['-s', join(PACKAGES, '..', '..', 'node_modules'), join(directory, 'node_modules')]);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ schema: 1, name: 'plasticine-server', version,
    commit: 'c'.repeat(40), builtAt: '2026-11-05T00:00:00.000Z', node: '>=24.11', releaseUrl: 'https://unused.test',
    excluded: [] }));
  // 建账号链接和重设密码（2026-11-08）：只核对 install.sh / plasticine 命令怎么调它们。
  writeFileSync(join(directory, 'agent/src/app/setup-link-cli.ts'), [
    "process.stdout.write('在浏览器里打开这个链接建账号（30 分钟内有效，只能用一次）：\\n');",
    "process.stdout.write(`  http://127.0.0.1:${process.env['PLASTICINE_PORT']}/#/setup?t=FAKE-SETUP-LINK\\n`);",
    '',
  ].join('\n'));
  writeFileSync(join(directory, 'agent/src/app/password-cli.ts'), [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const line = readFileSync(0, 'utf8').split('\\n')[0] ?? '';",
    "writeFileSync(process.env['PLASTICINE_STATE'] + '/password-cli-called',",
    "  JSON.stringify({ args: process.argv.slice(2), length: line.length }));",
    "process.stdout.write('密码改好了。\\n');",
    '',
  ].join('\n'));
  writeFileSync(join(directory, 'agent/src/app/main.ts'), [
    "import { createServer } from 'node:http';",
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "const state = process.env['PLASTICINE_STATE'] ?? '';",
    'mkdirSync(state, { recursive: true });',
    `writeFileSync(state + '/started-${version}', process.cwd());`,
    options.broken === true ? 'process.exit(1);' : '',
    'createServer((req, res) => {',
    "  res.writeHead(200, { 'content-type': 'application/json' });",
    `  res.end(JSON.stringify({ ok: true, version: '${version}', client: process.env['PLASTICINE_CLIENT_DIR'] }));`,
    "}).listen(Number(process.env['PLASTICINE_PORT']), '127.0.0.1');",
    "process.on('SIGTERM', () => process.exit(0));",
    '',
  ].join('\n'));
}
