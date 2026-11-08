import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkMacPackage } from './mac-package.ts';
import { DEFAULT_RELEASE_URL, sha256Hex } from './release-manifest.ts';
import { identifyMac, packageArtifacts, publishScratch } from './testing/publish-harness.ts';

const VERSION = '2026.1106.120000';
const COMMIT = 'c'.repeat(40);

test('Mac身份直接取自实际ZIP中的plist与服务清单，发布前再次核对字节和候选来源', (t) => {
  const artifacts = packageArtifacts(publishScratch(t), VERSION, COMMIT);
  const built = identifyMac(artifacts, VERSION, COMMIT);
  assert.equal(built.status, 0, built.stderr);
  const identity = checkMacPackage({ artifacts, version: VERSION, commit: COMMIT, baseUrl: DEFAULT_RELEASE_URL });
  const bytes = readFileSync(join(artifacts, `Plasticine-mac-${VERSION}.zip`));
  assert.deepEqual(identity, { schema: 1, version: VERSION, commit: COMMIT, appVersion: '0.7.3',
    releaseUrl: DEFAULT_RELEASE_URL, size: bytes.length, sha256: sha256Hex(bytes) });
});

test('Mac构建身份不符或App版本非法时不生成证明；发布端拒绝改过的ZIP、sidecar和发布来源', (t) => {
  const root = publishScratch(t);
  const artifacts = packageArtifacts(root, VERSION, COMMIT);
  const wrongCommit = identifyMac(artifacts, VERSION, 'd'.repeat(40));
  assert.notEqual(wrongCommit.status, 0);
  assert.match(wrongCommit.stderr, /commit|提交/);
  const invalid = packageArtifacts(join(root, 'invalid'), VERSION, COMMIT, '0.7.3 beta');
  assert.notEqual(identifyMac(invalid, VERSION, COMMIT).status, 0);
  assert.equal(identifyMac(artifacts, VERSION, COMMIT).status, 0);
  const input = { artifacts, version: VERSION, commit: COMMIT, baseUrl: DEFAULT_RELEASE_URL };
  const path = join(artifacts, 'mac-package.json');
  const original = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  for (const patch of [{ commit: 'd'.repeat(40) }, { version: '2026.1106.120001' },
    { releaseUrl: 'https://wrong.example/download' }, { releaseUrl: 'https://user:pass@example.com/download' },
    { size: 1 }, { sha256: 'a'.repeat(64) }, { appVersion: '../latest' }]) {
    writeFileSync(path, JSON.stringify({ ...original, ...patch }));
    assert.throws(() => checkMacPackage(input));
  }
  writeFileSync(path, JSON.stringify(original));
  const serverPath = join(artifacts, 'server-manifest.json');
  const server = JSON.parse(readFileSync(serverPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(serverPath, JSON.stringify({ ...server, releaseUrl: 'https://wrong.example/download' }));
  assert.throws(() => checkMacPackage(input), /发布点/);
  writeFileSync(serverPath, JSON.stringify(server));
  writeFileSync(join(artifacts, `Plasticine-mac-${VERSION}.zip`), 'changed zip');
  assert.throws(() => checkMacPackage(input), /ZIP|zip|校验/);
});
