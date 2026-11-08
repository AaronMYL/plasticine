import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetUrl, isNewerVersion, manifestUrl, nodeSatisfies, packageVersion, parseReleaseManifest,
  parseServerManifest, sameNodeMajor, sha256Hex } from './release-manifest.ts';

const COMMIT = 'a'.repeat(40);

function release(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const asset = { name: 'plasticine-server-2026.1105.093012.tar.gz', url: 'plasticine-server.tar.gz',
    sha256: 'b'.repeat(64), size: 10 };
  return { schema: 1, version: '2026.1105.093012', commit: COMMIT, publishedAt: '2026-11-05T09:30:12.000Z',
    nodeVersion: '24.22.1', assets: { server: asset, linuxInstaller: { ...asset, name: 'install.sh' } },
    ...overrides };
}

test('版本号由提交时间（UTC）定，逐段数字越大越新', () => {
  assert.equal(packageVersion(new Date('2026-11-05T09:30:12+08:00')), '2026.1105.013012');
  assert.equal(packageVersion(new Date('2027-01-02T23:04:05Z')), '2027.0102.230405');
  assert.ok(isNewerVersion('2027.0102.230405', '2026.1231.235959'));
  assert.ok(isNewerVersion('2026.1105.013013', '2026.1105.013012'));
  assert.equal(isNewerVersion('2026.1105.013012', '2026.1105.013012'), false);
  assert.equal(isNewerVersion('2026.0105.000000', '2026.1105.000000'), false);
  assert.throws(() => packageVersion(new Date('不是时间')), /提交时间无效/);
});

test('Node 版本：满足最低要求、同一主版本', () => {
  assert.ok(nodeSatisfies('v24.22.1', '>=24.11'));
  assert.ok(nodeSatisfies('24.11.0', '>=24.11'));
  assert.equal(nodeSatisfies('v24.10.9', '>=24.11'), false);
  assert.equal(nodeSatisfies('v22.20.0', '>=24.11'), false);
  assert.ok(sameNodeMajor('v24.1.0', '24.22.1'));
  assert.equal(sameNodeMajor('v26.0.0', '24.22.1'), false);
});

test('发布清单过 schema；缺字段、校验值不是 64 位十六进制都拒绝', () => {
  assert.equal(parseReleaseManifest(JSON.stringify(release())).version, '2026.1105.093012');
  assert.throws(() => parseReleaseManifest(JSON.stringify(release({ version: '1.0' }))), /发布清单 格式不对/);
  const bad = release();
  (bad['assets'] as { server: { sha256: string } }).server.sha256 = 'XYZ';
  assert.throws(() => parseReleaseManifest(JSON.stringify(bad)), /sha256/);
  assert.throws(() => parseReleaseManifest(JSON.stringify(release({ extra: true }))), /格式不对/);
});

test('服务包的 manifest.json 过 schema', () => {
  const manifest = { schema: 1, name: 'plasticine-server', version: '2026.1105.093012', commit: COMMIT,
    builtAt: '2026-11-05T09:30:12.000Z', node: '>=24.11', releaseUrl: 'https://example.com/r',
    excluded: ['agent/src/network-relay/'] };
  assert.equal(parseServerManifest(JSON.stringify(manifest)).name, 'plasticine-server');
  assert.throws(() => parseServerManifest(JSON.stringify({ ...manifest, name: 'other' })), /格式不对/);
});

test('资源地址：相对地址按清单位置解析；只认 https、本机文件和本机 http', () => {
  const manifest = manifestUrl('https://github.com/o/r/releases/latest/download');
  assert.equal(manifest.href, 'https://github.com/o/r/releases/latest/download/manifest.json');
  const asset = { name: 'a', url: 'plasticine-server.tar.gz', sha256: 'b'.repeat(64), size: 1 };
  assert.equal(assetUrl(asset, manifest.href).href,
    'https://github.com/o/r/releases/latest/download/plasticine-server.tar.gz');
  assert.equal(assetUrl({ ...asset, url: 'https://x.test/p.tgz' }, manifest.href).href, 'https://x.test/p.tgz');
  assert.equal(manifestUrl('file:///srv/release/').href, 'file:///srv/release/manifest.json');
  assert.equal(manifestUrl('http://127.0.0.1:9/r').href, 'http://127.0.0.1:9/r/manifest.json');
  assert.throws(() => manifestUrl('http://example.com/r'), /只能是 https/);
  assert.throws(() => assetUrl({ ...asset, url: 'http://example.com/p.tgz' }, manifest.href), /只能是 https/);
  assert.throws(() => manifestUrl('https://user:pass@example.com/r'), /只能是 https/);
});

test('SHA-256 十六进制', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
