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

function artifacts(root: string, version: string, extra = ''): string {
  const directory = join(root, `artifacts-${version}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `plasticine-server-${version}.tar.gz`), `server ${version}${extra}`);
  writeFileSync(join(directory, 'install.sh'), `#!/bin/sh\n# ${version}\n`);
  writeFileSync(join(directory, 'server-manifest.json'), JSON.stringify({ schema: 1, name: 'plasticine-server',
    version, commit: 'c'.repeat(40), builtAt: '2026-11-05T09:30:12.000Z', node: '>=24.11',
    releaseUrl: DEFAULT_RELEASE_URL, excluded: [] }));
  return directory;
}

test('defaults publish base URL to https://cyberhunter.top/download', () => {
  assert.equal(DEFAULT_RELEASE_URL, 'https://cyberhunter.top/download');
});

test('locates agent tarball and install script by version and names missing file clearly', (t) => {
  const root = scratch(t);
  const directory = artifacts(root, V1);
  const files = releaseFiles(directory, V1);
  assert.equal(files.server, join(directory, `plasticine-server-${V1}.tar.gz`));
  assert.equal(files.installer, join(directory, 'install.sh'));
  rmSync(files.server);
  assert.throws(() => releaseFiles(directory, V1), /plasticine-server-2026\.1105\.093012\.tar\.gz/);
});

test('copies archive to <version>/, updates root manifest.json and install.sh with versioned URLs', (t) => {
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
  assert.deepEqual(Object.keys(manifest.assets), ['server', 'linuxInstaller']);
  assert.equal(readFileSync(join(target, 'install.sh'), 'utf8'), `#!/bin/sh\n# ${V1}\n`);
  assert.ok(existsSync(join(target, V1, 'install.sh')));
  assert.equal(statSync(join(target, 'manifest.json')).mode & 0o777, 0o644);
  assert.equal(statSync(join(target, V1)).mode & 0o777, 0o755);
  assert.equal(existsSync(join(target, V1, 'server-manifest.json')), false);
});

test('next release keeps previous version directory intact while updating root manifest', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target, baseUrl: DEFAULT_RELEASE_URL });
  publishRelease({ artifacts: artifacts(root, V2), version: V2, root: target, baseUrl: DEFAULT_RELEASE_URL });
  assert.ok(existsSync(join(target, V1, `plasticine-server-${V1}.tar.gz`)));
  assert.equal(parseReleaseManifest(readFileSync(join(target, 'manifest.json'), 'utf8')).version, V2);
});

test('republishing identical version preserves manifest and timestamp; differing content is rejected', (t) => {
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

test('late older build rejects downgrade without mutating manifest, install.sh, or creating old dir', (t) => {
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

test('retrying historical version does not revert latest pointer and preserves historical files', (t) => {
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

test('same version and bytes with different commit still conflicts without rewriting provenance', (t) => {
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

test('stops on corrupt existing manifest instead of overwriting it as first release', (t) => {
  const root = scratch(t);
  const target = join(root, 'www');
  mkdirSync(target);
  writeFileSync(join(target, 'manifest.json'), '{broken');
  assert.throws(() => publishRelease({ artifacts: artifacts(root, V1), version: V1, root: target,
    baseUrl: DEFAULT_RELEASE_URL }), /现有发布清单/);
  assert.equal(readFileSync(join(target, 'manifest.json'), 'utf8'), '{broken');
  assert.equal(existsSync(join(target, V1)), false);
});

test('passes verification only when public manifest matches written version, commit, and archive', async (t) => {
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

test('HTTP error, non-manifest response, or network error fails publish verification', async (t) => {
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

test('publish command exits non-zero on public verify failure and allows identical retry once fixed', (t) => {
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

test('validates version matches agent archive and accepts https URLs only', (t) => {
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
