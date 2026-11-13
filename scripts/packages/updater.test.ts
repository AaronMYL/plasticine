import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { acquireLock, layoutOf, pointTo } from './install-layout.ts';
import { sha256Hex, type ReleaseManifest, type ServerManifest } from './release-manifest.ts';
import { rollback, status, update, type UpdaterDeps } from './updater.ts';

const RELEASE_URL = 'https://releases.test/latest/download';
const V1 = '2026.1101.000000';
const V2 = '2026.1105.120000';

function serverManifest(version: string): ServerManifest {
  return { schema: 1, name: 'plasticine-server', version, commit: 'c'.repeat(40), builtAt: '2026-11-05T12:00:00.000Z',
    node: '>=24.11', releaseUrl: RELEASE_URL, excluded: [] };
}

/** 假的服务包：JSON 写着要解出来的文件。 */
function archive(version: string, manifestVersion = version): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ 'manifest.json': JSON.stringify(serverManifest(manifestVersion)),
    'agent/src/app/main.ts': `// ${version}` }));
}

interface Fake {
  deps: UpdaterDeps;
  files: Map<string, Uint8Array>;
  restarts: string[][];
  health: boolean[];
  logs: string[];
}

function fake(health: boolean[] = [true]): Fake {
  const files = new Map<string, Uint8Array>();
  const restarts: string[][] = [];
  const logs: string[] = [];
  const deps: UpdaterDeps = {
    async fetchBytes(url) {
      const bytes = files.get(url.href);
      if (bytes === undefined) { throw new Error(`404 ${url.href}`); }
      return bytes;
    },
    async extract(file, into) {
      const entries = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
      for (const [path, content] of Object.entries(entries)) {
        mkdirSync(join(into, path, '..'), { recursive: true });
        writeFileSync(join(into, path), content);
      }
    },
    async restart(command) { restarts.push([...command]); return 0; },
    async healthy() { return health.shift() ?? true; },
    now: () => new Date('2026-11-05T13:00:00Z'),
    log: (line) => logs.push(line),
    nodeVersion: 'v24.22.1',
  };
  return { deps, files, restarts, health, logs };
}

function publish(f: Fake, version: string, overrides: Partial<ReleaseManifest> = {}, bytes = archive(version)): void {
  const name = `plasticine-server-${version}.tar.gz`;
  f.files.set(`${RELEASE_URL}/${name}`, bytes);
  const asset = { name, url: name, sha256: sha256Hex(bytes), size: bytes.length };
  const manifest: ReleaseManifest = { schema: 1, version, commit: 'c'.repeat(40),
    publishedAt: '2026-11-05T12:00:00.000Z', nodeVersion: '24.22.1',
    assets: { server: asset, linuxInstaller: { ...asset, name: 'install.sh' } }, ...overrides };
  f.files.set(`${RELEASE_URL}/manifest.json`, new TextEncoder().encode(JSON.stringify(manifest)));
}

function installed(t: { after(fn: () => void): void }, version = V1): string {
  const root = mkdtempSync(join(tmpdir(), 'plasticine-update-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const layout = layoutOf(root);
  mkdirSync(join(layout.versions, version), { recursive: true });
  writeFileSync(join(layout.versions, version, 'manifest.json'), JSON.stringify(serverManifest(version)));
  pointTo(layout, layout.current, version);
  return root;
}

const RESTART = ['systemctl', 'restart', 'plasticine.service'];
const options = (root: string) => ({ root, port: 8790, healthTimeoutMs: 1000, restartCommand: RESTART });

test('发布点上的版本不比装着的新：什么都不动', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V1);
  assert.deepEqual(await update(options(root), f.deps), { kind: 'up_to_date', version: V1 });
  assert.deepEqual(f.restarts, []);
  assert.equal(status(root).lastResult, `已是最新（${V1}）`);
});

test('有新版：下载、核对、解开、换指针、重启、健康；上一版留作回退，更早的删掉', async (t) => {
  const root = installed(t);
  mkdirSync(join(layoutOf(root).versions, '2026.1001.000000'));
  const f = fake();
  publish(f, V2);
  assert.deepEqual(await update(options(root), f.deps), { kind: 'updated', from: V1, to: V2, restarted: true });
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V2));
  assert.equal(readlinkSync(join(root, 'previous')), join('versions', V1));
  assert.deepEqual(f.restarts, [RESTART]);
  assert.equal(existsSync(join(root, 'versions', '2026.1001.000000')), false);
  assert.equal(existsSync(join(root, 'downloads')), false);
  assert.equal(readFileSync(join(root, 'current', 'agent/src/app/main.ts'), 'utf8'), `// ${V2}`);
});

test('校验值对不上就不装，指针不动', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V2);
  f.files.set(`${RELEASE_URL}/plasticine-server-${V2}.tar.gz`, archive('被换掉的包'));
  await assert.rejects(update(options(root), f.deps), /SHA-256 和发布清单对不上/);
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V1));
  assert.equal(existsSync(join(root, 'versions', V2)), false);
  assert.equal(existsSync(join(root, 'update.lock')), false);
});

test('包里的版本和清单说的不一样就不装', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V2, {}, archive(V2, '2026.1106.000000'));
  await assert.rejects(update(options(root), f.deps), /包里的版本是 2026\.1106\.000000/);
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V1));
});

test('新版启动后不健康：自动退回上一版、重启，这一版记下不再自动装', async (t) => {
  const root = installed(t);
  const f = fake([false, true]);
  publish(f, V2);
  assert.deepEqual(await update(options(root), f.deps), { kind: 'rolled_back', to: V1, failed: V2 });
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V1));
  assert.deepEqual(f.restarts, [RESTART, RESTART]);
  // previous 回到更新之前的样子（这里本来没有），坏版本目录删掉。
  assert.equal(existsSync(join(root, 'previous')), false);
  assert.equal(existsSync(join(root, 'versions', V2)), false);
  assert.deepEqual(status(root).skipped, [V2]);
  const again = await update(options(root), f.deps);
  assert.equal(again.kind, 'skipped');
  assert.deepEqual(f.restarts, [RESTART, RESTART]);
});

test('新版要的 Node 主版本和本机不同：不自更新，提示重跑安装命令', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V2, { nodeVersion: '26.1.0' });
  const outcome = await update(options(root), f.deps);
  assert.equal(outcome.kind, 'skipped');
  assert.match(outcome.kind === 'skipped' ? outcome.reason : '', /重跑一次安装命令/);
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V1));
});

test('一步回退：current 和 previous 对调；再回退一次又回来', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V2);
  await update(options(root), f.deps);
  assert.deepEqual(await rollback(options(root), f.deps), { kind: 'rolled_back', from: V2, to: V1, healthy: true });
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V1));
  assert.equal(readlinkSync(join(root, 'previous')), join('versions', V2));
  await rollback(options(root), f.deps);
  assert.equal(readlinkSync(join(root, 'current')), join('versions', V2));
});

test('没有上一版时回退报错；没装过时更新报错', async (t) => {
  const root = installed(t);
  await assert.rejects(rollback(options(root), fake().deps), /没有可以回退的上一版/);
  const empty = mkdtempSync(join(tmpdir(), 'plasticine-update-empty-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  await assert.rejects(update(options(empty), fake().deps), /先运行 install\.sh/);
});

test('同一时间只跑一个更新；锁超过一小时算残留', (t) => {
  const root = installed(t);
  const layout = layoutOf(root);
  const release = acquireLock(layout, new Date());
  assert.throws(() => acquireLock(layout, new Date()), /另一个更新正在进行/);
  release();
  writeFileSync(layout.lock, 'old');
  const later = new Date(Date.now() + 2 * 60 * 60 * 1000);
  acquireLock(layout, later)();
  assert.equal(existsSync(layout.lock), false);
});

test('没给重启命令：只换指针，不重启，由调用方重启', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V2);
  const outcome = await update({ root, port: 8790, healthTimeoutMs: 1000 }, f.deps);
  assert.deepEqual(outcome, { kind: 'updated', from: V1, to: V2, restarted: false });
  assert.deepEqual(f.restarts, []);
});

test('上一版留满 7 天就删：没有新版本，每天那次检查也会清；不满 7 天留着', async (t) => {
  const root = installed(t);
  const f = fake();
  publish(f, V2);
  await update(options(root), f.deps);
  assert.equal(readlinkSync(join(root, 'previous')), join('versions', V1));
  const day = 24 * 60 * 60 * 1000;
  const start = f.deps.now().getTime();
  const at = (ms: number) => ({ ...f.deps, now: () => new Date(start + ms) });
  assert.deepEqual(await update(options(root), at(6 * day)), { kind: 'up_to_date', version: V2 });
  assert.equal(existsSync(join(root, 'versions', V1)), true);
  assert.deepEqual(await update(options(root), at(7 * day)), { kind: 'up_to_date', version: V2 });
  assert.equal(existsSync(join(root, 'previous')), false);
  assert.equal(existsSync(join(root, 'versions', V1)), false);
  assert.equal(existsSync(join(root, 'versions', V2)), true);
  assert.equal(status(root).previous, null);
});
