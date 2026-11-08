import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PackagesPublishError, publishPackages, type PackagesPublishOptions } from './publish-packages.ts';
import { DEFAULT_RELEASE_URL, parseReleaseManifest, sha256Hex } from './release-manifest.ts';
import { identifyMac, legacyPublisher, packageArtifacts, publishScratch } from './testing/publish-harness.ts';

const V1 = '2026.1106.120000';
const V2 = '2026.1106.130000';
const C1 = 'c'.repeat(40);
const C2 = 'd'.repeat(40);

function fixture(t: { after(fn: () => void): void }) {
  const directory = publishScratch(t);
  const legacy = legacyPublisher(directory);
  function candidate(version = V1, commit = C1): PackagesPublishOptions {
    const artifacts = packageArtifacts(directory, version, commit);
    const identity = identifyMac(artifacts, version, commit);
    assert.equal(identity.status, 0, identity.stderr);
    return { artifacts, version, commit, root: join(directory, 'www'), baseUrl: DEFAULT_RELEASE_URL,
      stateDirectory: legacy.stateDirectory, now: new Date('2026-11-06T14:00:00.000Z') };
  }
  const fetcher: typeof fetch = async () => new Response(readFileSync(join(directory, 'www/manifest.json')));
  return { directory, legacy, candidate, dependencies: { fetcher, macCommands: legacy.commands } };
}

test('三平台发行只用一个MacZIP：公开验证后落同字节兼容桥；精确重试保留原回执来源和发布时间', async (t) => {
  const f = fixture(t);
  f.legacy.seed();
  const candidate = f.candidate();
  const published = await publishPackages(candidate, f.dependencies);
  assert.equal(published.status, 'complete');
  assert.equal(published.public.status, 'verified');
  assert.equal(published.compatibility.status, 'published');
  assert.ok('release' in published.compatibility);
  const release = published.compatibility.release;
  assert.equal(release.version, '0.7.3');
  assert.equal(release.commit, C1);
  assert.equal(release.bridge?.releaseVersion, V1);
  const manifestPath = join(candidate.root, 'manifest.json');
  const before = readFileSync(manifestPath, 'utf8');
  const mac = parseReleaseManifest(before).assets.mac;
  assert.ok(mac !== undefined);
  assert.equal(mac.sha256, release.sha256);
  assert.equal(sha256Hex(readFileSync(join(f.legacy.directory, release.file))), mac.sha256);
  assert.deepEqual(readFileSync(join(candidate.root, V1, mac.name)),
    readFileSync(join(f.legacy.directory, release.file)));
  const retried = await publishPackages({ ...candidate, now: new Date('2026-11-07T14:00:00Z') }, f.dependencies);
  assert.equal(retried.compatibility.status, 'unchanged');
  assert.ok('release' in retried.compatibility);
  assert.deepEqual(retried.compatibility.release, release);
  assert.equal(readFileSync(manifestPath, 'utf8'), before);
  assert.ok(existsSync(join(f.legacy.directory, 'Plasticine-0.7.2.zip')));
});

test('后续日期版同App版本：公开catalog前进，明确保留较早bridge并在回执写出其真实commit/hash', async (t) => {
  const f = fixture(t);
  f.legacy.seed();
  const first = await publishPackages(f.candidate(), f.dependencies);
  const bridge = readFileSync(f.legacy.latest, 'utf8');
  const next = f.candidate(V2, C2);
  const published = await publishPackages(next, f.dependencies);
  assert.equal(published.status, 'complete');
  assert.equal(published.compatibility.status, 'retained');
  assert.ok('release' in published.compatibility && 'release' in first.compatibility);
  assert.deepEqual(published.compatibility.release, first.compatibility.release);
  assert.equal(published.compatibility.release.commit, C1);
  assert.equal(published.candidate.commit, C2);
  const current = parseReleaseManifest(readFileSync(join(next.root, 'manifest.json'), 'utf8'));
  assert.equal(current.version, V2);
  assert.equal(current.commit, C2);
  assert.notEqual(current.assets.mac?.sha256, published.compatibility.release.sha256);
  assert.equal(readFileSync(f.legacy.latest, 'utf8'), bridge);
  assert.equal((await publishPackages(next, f.dependencies)).compatibility.status, 'retained');
});

test('public成功而legacy失败：明确partial且不回退；原包重试可补齐，不重写旧版本ZIP', async (t) => {
  const f = fixture(t);
  const previous = f.legacy.seed();
  const candidate = f.candidate();
  f.legacy.failures.nextLatest = true;
  await assert.rejects(publishPackages(candidate, f.dependencies), (error: unknown) => {
    assert.ok(error instanceof PackagesPublishError);
    assert.equal(error.receipt.status, 'partial');
    assert.equal(error.receipt.public.status, 'verified');
    assert.equal(error.receipt.compatibility.status, 'failed');
    assert.match(error.message, /injected latest failure/);
    return true;
  });
  const manifest = readFileSync(join(candidate.root, 'manifest.json'), 'utf8');
  assert.equal(parseReleaseManifest(manifest).commit, C1);
  assert.equal(readFileSync(f.legacy.latest, 'utf8'), previous);
  const installsBefore = f.legacy.calls.filter((args) => args.includes('install')
    && args.at(-1)?.endsWith('.zip.part')).length;
  const retried = await publishPackages(candidate, f.dependencies);
  assert.equal(retried.status, 'complete');
  assert.equal(retried.compatibility.status, 'published');
  assert.equal(readFileSync(join(candidate.root, 'manifest.json'), 'utf8'), manifest);
  assert.equal(f.legacy.calls.filter((args) => args.includes('install')
    && args.at(-1)?.endsWith('.zip.part')).length, installsBefore);
});

test('公网manifest验证失败会以partial失败，兼容入口不动；修好后可原样重试', async (t) => {
  const f = fixture(t);
  const previous = f.legacy.seed();
  const candidate = f.candidate();
  await assert.rejects(publishPackages(candidate, { ...f.dependencies,
    fetcher: async () => new Response('{}', { status: 404 }) }), (error: unknown) => {
    assert.ok(error instanceof PackagesPublishError);
    assert.equal(error.receipt.status, 'partial');
    assert.equal(error.receipt.public.status, 'written');
    assert.equal(error.receipt.compatibility.status, 'not_attempted');
    return true;
  });
  assert.equal(f.legacy.calls.length, 0);
  assert.equal(readFileSync(f.legacy.latest, 'utf8'), previous);
  assert.equal((await publishPackages(candidate, f.dependencies)).status, 'complete');
});

test('身份坏掉在发布前失败；现有legacy latest损坏在public后报partial且不覆盖', async (t) => {
  const f = fixture(t);
  const candidate = f.candidate();
  const identityPath = join(candidate.artifacts, 'mac-package.json');
  const identity = readFileSync(identityPath, 'utf8');
  writeFileSync(identityPath, '{}');
  await assert.rejects(publishPackages(candidate, f.dependencies), (error: unknown) => {
    assert.ok(error instanceof PackagesPublishError);
    assert.equal(error.receipt.status, 'failed');
    assert.equal(error.receipt.public.status, 'pending');
    return true;
  });
  assert.equal(existsSync(candidate.root), false);
  assert.equal(f.legacy.calls.length, 0);
  writeFileSync(identityPath, identity);
  f.legacy.seed();
  writeFileSync(f.legacy.latest, '{bad');
  await assert.rejects(publishPackages(candidate, f.dependencies), (error: unknown) => {
    assert.ok(error instanceof PackagesPublishError);
    assert.equal(error.receipt.status, 'partial');
    assert.equal(error.receipt.compatibility.status, 'failed');
    return true;
  });
  assert.equal(readFileSync(f.legacy.latest, 'utf8'), '{bad');
  assert.ok(!f.legacy.calls.some((args) => args.includes('install')));
});

test('旧尝试已经占用的App版本ZIP内容不同：报partial并保留文件和旧latest', async (t) => {
  const f = fixture(t);
  const previous = f.legacy.seed();
  const candidate = f.candidate();
  const zip = join(f.legacy.directory, 'Plasticine-0.7.3.zip');
  writeFileSync(zip, 'different previous attempt');
  await assert.rejects(publishPackages(candidate, f.dependencies), (error: unknown) => {
    assert.ok(error instanceof PackagesPublishError);
    assert.equal(error.receipt.status, 'partial');
    assert.match(error.message, /校验值对不上/);
    return true;
  });
  assert.equal(readFileSync(zip, 'utf8'), 'different previous attempt');
  assert.equal(readFileSync(f.legacy.latest, 'utf8'), previous);
  assert.ok(!f.legacy.calls.some((args) => args.includes('install')));
});

test('统一发行CLI在公网404时退出1，并把已落盘但未验证写进JSON回执', (t) => {
  const f = fixture(t);
  const candidate = f.candidate();
  const preload = join(f.directory, 'fetch-404.mjs');
  writeFileSync(preload, "globalThis.fetch = async () => new Response('{}', { status: 404 });\n");
  const command = fileURLToPath(new URL('./publish-packages.ts', import.meta.url));
  const run = spawnSync(process.execPath, ['--import', preload, command, '--artifacts', candidate.artifacts,
    '--version', candidate.version, '--commit', candidate.commit, '--root', candidate.root,
    '--base-url', candidate.baseUrl], { encoding: 'utf8', timeout: 5_000 });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /公网.*404/);
  const receipt = JSON.parse(run.stdout) as { status: string; public: { status: string } };
  assert.equal(receipt.status, 'partial');
  assert.equal(receipt.public.status, 'written');
  assert.equal(parseReleaseManifest(readFileSync(join(candidate.root, 'manifest.json'), 'utf8')).commit, C1);
});
