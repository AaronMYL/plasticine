import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { publishRelease, releaseFiles, verifyPublishedRelease } from './publish-release.ts';
import { DEFAULT_RELEASE_URL, parseReleaseManifest, sha256Hex } from './release-manifest.ts';

const V1 = '2026.1105.093012';
const V2 = '2026.1106.101500';

function scratch(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-publish-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** 发布工作流下载下来的一版：四个包 + 服务包里的 manifest.json。 */
function artifacts(root: string, version: string, extra = ''): string {
  const directory = join(root, `artifacts-${version}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `plasticine-server-${version}.tar.gz`), `server ${version}${extra}`);
  writeFileSync(join(directory, 'install.sh'), `#!/bin/sh\n# ${version}\n`);
  writeFileSync(join(directory, `Plasticine-mac-${version}.zip`), `mac ${version}`);
  writeFileSync(join(directory, `Plasticine-Setup-${version}.exe`), `exe ${version}`);
  writeFileSync(join(directory, 'server-manifest.json'), JSON.stringify({ schema: 1, name: 'plasticine-server',
    version, commit: 'c'.repeat(40), builtAt: '2026-11-05T09:30:12.000Z', node: '>=24.11',
    releaseUrl: DEFAULT_RELEASE_URL, excluded: [] }));
  return directory;
}

test('发布点默认是 https://cyberhunter.top/download（2026-11-05 他定）', () => {
  assert.equal(DEFAULT_RELEASE_URL, 'https://cyberhunter.top/download');
});

test('一版的文件：四个包按版本号找，少一个就说清楚缺哪个', (t) => {
  const root = scratch(t);
  const directory = artifacts(root, V1);
  const files = releaseFiles(directory, V1);
  assert.equal(files.server, join(directory, `plasticine-server-${V1}.tar.gz`));
  assert.equal(files.windows, join(directory, `Plasticine-Setup-${V1}.exe`));
  rmSync(files.mac ?? '');
  assert.throws(() => releaseFiles(directory, V1), /Plasticine-mac-2026\.1105\.093012\.zip/);
});

test('发布：包拷进 <版本>/，根上换 manifest.json 和 install.sh；清单里的地址指向这一版的目录', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  const result = publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target,
    baseUrl: 'https://cyberhunter.top/download/', now: new Date('2026-11-05T10:00:00Z') });
  assert.equal(result.version, V1);
  const manifest = parseReleaseManifest(readFileSync(join(target, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, V1);
  assert.equal(manifest.assets.server.url,
    `https://cyberhunter.top/download/${V1}/plasticine-server-${V1}.tar.gz`);
  assert.equal(manifest.assets.server.sha256,
    sha256Hex(readFileSync(join(target, V1, `plasticine-server-${V1}.tar.gz`))));
  assert.ok(manifest.assets.mac !== undefined && manifest.assets.windows !== undefined);
  assert.equal(readFileSync(join(target, 'install.sh'), 'utf8'), `#!/bin/sh\n# ${V1}\n`);
  assert.ok(existsSync(join(target, V1, 'install.sh')));
  assert.equal(statSync(join(target, 'manifest.json')).mode & 0o777, 0o644);
  assert.equal(statSync(join(target, V1)).mode & 0o777, 0o755);
  assert.equal(existsSync(join(target, V1, 'server-manifest.json')), false);
});

test('下一版：旧版本目录留着（已装的实例还可能正在下），清单换成新的', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL });
  publishRelease({ artifacts: artifacts(root, V2), version: V2, root: target, baseUrl: DEFAULT_RELEASE_URL });
  assert.ok(existsSync(join(target, V1, `plasticine-server-${V1}.tar.gz`)));
  assert.equal(parseReleaseManifest(readFileSync(join(target, 'manifest.json'), 'utf8')).version, V2);
});

test('同一版重发：原样重试保留清单和发布时间；内容不一样就拒绝', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL,
    now: new Date('2026-11-05T10:00:00Z') });
  const original = readFileSync(join(target, 'manifest.json'), 'utf8');
  publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL,
    now: new Date('2026-11-06T10:00:00Z') });
  assert.equal(readFileSync(join(target, 'manifest.json'), 'utf8'), original);
  const changed = artifacts(join(root, 'again'), V1, '（改过）');
  assert.throws(() => publishRelease({ artifacts: changed, version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL }),
    /已经发布过，内容不一样/);
  assert.equal(readFileSync(join(target, V1, `plasticine-server-${V1}.tar.gz`), 'utf8'), `server ${V1}`);
});

test('旧构建晚到：拒绝倒退，当前清单和安装脚本都保持新版，不创建旧版本目录', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  publishRelease({ artifacts: artifacts(root, V2), version: V2, root: target, baseUrl: DEFAULT_RELEASE_URL });
  const original = readFileSync(join(target, 'manifest.json'), 'utf8');
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target,
    baseUrl: DEFAULT_RELEASE_URL }), /不比当前发布的.*新/);
  assert.equal(readFileSync(join(target, 'manifest.json'), 'utf8'), original);
  assert.equal(readFileSync(join(target, 'install.sh'), 'utf8'), `#!/bin/sh\n# ${V2}\n`);
  assert.equal(existsSync(join(target, V1)), false);
});

test('历史版本原样重试也不能把 latest 指回去，已发布的历史文件保留', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  const first = artifacts(root, V1);
  publishRelease({ artifacts: first, version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL });
  publishRelease({ artifacts: artifacts(root, V2), version: V2, root: target, baseUrl: DEFAULT_RELEASE_URL });
  assert.throws(() => publishRelease({ artifacts: first, version: V1, root: target,
    baseUrl: DEFAULT_RELEASE_URL }), /不比当前发布的.*新/);
  assert.equal(parseReleaseManifest(readFileSync(join(target, 'manifest.json'), 'utf8')).version, V2);
  assert.ok(existsSync(join(target, V1, `plasticine-server-${V1}.tar.gz`)));
});

test('相同版本的包字节相同但提交不同：仍是冲突，不能改写来源', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  const directory = artifacts(root, V1);
  publishRelease({ artifacts: directory, version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL });
  const original = readFileSync(join(target, 'manifest.json'), 'utf8');
  const path = join(directory, 'server-manifest.json');
  const server = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...server, commit: 'd'.repeat(40) }));
  assert.throws(() => publishRelease({ artifacts: directory, version: V1, root: target,
    baseUrl: DEFAULT_RELEASE_URL }), /已经发布过，内容不一样/);
  assert.equal(readFileSync(join(target, 'manifest.json'), 'utf8'), original);
});

test('现有发布清单损坏：停止，不把它当作第一次发布覆盖', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  mkdirSync(target);
  writeFileSync(join(target, 'manifest.json'), '{broken');
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target,
    baseUrl: DEFAULT_RELEASE_URL }), /现有发布清单/);
  assert.equal(readFileSync(join(target, 'manifest.json'), 'utf8'), '{broken');
  assert.equal(existsSync(join(target, V1)), false);
});

test('公网清单和刚落盘的版本、提交、包信息一致才算验证通过', async (t) => {
  const root = scratch(t);
  const result = publishRelease({ artifacts: artifacts(root, V1), version: V1, root: join(root, 'www'),
    baseUrl: DEFAULT_RELEASE_URL });
  const text = readFileSync(result.manifest, 'utf8');
  const expected = parseReleaseManifest(text);
  let requested = '';
  await verifyPublishedRelease(result.manifest, DEFAULT_RELEASE_URL, async (url) => {
    requested = String(url);
    return new Response(text);
  });
  assert.equal(requested, `${DEFAULT_RELEASE_URL}/manifest.json`);
  for (const changed of [{ ...expected, version: V2 }, { ...expected, commit: 'd'.repeat(40) },
    { ...expected, assets: { ...expected.assets,
      server: { ...expected.assets.server, sha256: 'f'.repeat(64) } } }]) {
    await assert.rejects(verifyPublishedRelease(result.manifest, DEFAULT_RELEASE_URL,
      async () => new Response(JSON.stringify(changed))), /公网发布清单.*不一致/);
  }
});

test('公网 HTTP 错误、非清单响应或网络错误都使发布验证失败，不把落盘成功当作已可下载', async (t) => {
  const root = scratch(t);
  const result = publishRelease({ artifacts: artifacts(root, V1), version: V1, root: join(root, 'www'),
    baseUrl: DEFAULT_RELEASE_URL });
  await assert.rejects(verifyPublishedRelease(result.manifest, DEFAULT_RELEASE_URL,
    async () => new Response('missing', { status: 404 })), /公网发布清单.*404/);
  await assert.rejects(verifyPublishedRelease(result.manifest, DEFAULT_RELEASE_URL,
    async () => new Response('<html>not a manifest</html>')), /公网发布清单/);
  await assert.rejects(verifyPublishedRelease(result.manifest, DEFAULT_RELEASE_URL,
    async () => { throw new Error('offline'); }), /公网发布清单/);
});

test('发布命令：公网验证失败以非零退出，修好发布点后同版可原样重试', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  const directory = artifacts(root, V1);
  const preload = join(root, 'fake-fetch.mjs');
  const command = fileURLToPath(new URL('./publish-release.ts', import.meta.url));
  const args = ['--import', preload, command, '--artifacts', directory, '--version', V1,
    '--commit', 'c'.repeat(40), '--root', target, '--base-url', DEFAULT_RELEASE_URL];
  writeFileSync(preload, "globalThis.fetch = async () => new Response('missing', { status: 404 });\n");
  const failed = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5_000 });
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stderr, /公网发布清单.*404/);
  const original = readFileSync(join(target, 'manifest.json'), 'utf8');
  writeFileSync(preload, "import { readFileSync } from 'node:fs';\n"
    + `globalThis.fetch = async () => new Response(readFileSync(${JSON.stringify(join(target, 'manifest.json'))}));\n`);
  const retried = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 5_000 });
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal((JSON.parse(retried.stdout) as { publicVerified: boolean }).publicVerified, true);
  assert.equal(readFileSync(join(target, 'manifest.json'), 'utf8'), original);
});

test('版本号要对得上服务包里的那一份；地址只认 https', (t) => {
  const root = scratch(t);
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: V2, root: join(root, 'www'),
    baseUrl: DEFAULT_RELEASE_URL }), /版本/);
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: V1, root: join(root, 'www'),
    baseUrl: 'http://cyberhunter.top/download' }), /https/);
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: '../x', root: join(root, 'www'),
    baseUrl: DEFAULT_RELEASE_URL }), /版本号/);
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: V1, commit: 'd'.repeat(40),
    root: join(root, 'www'), baseUrl: DEFAULT_RELEASE_URL }), /候选 SHA/);
});
