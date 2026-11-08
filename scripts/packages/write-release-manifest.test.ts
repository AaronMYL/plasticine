import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE_NODE_VERSION, sha256Hex } from './release-manifest.ts';
import { releaseManifest } from './write-release-manifest.ts';

const BASE = 'https://cyberhunter.top/download/2026.1105.093012';

test('发布清单：版本和提交取自服务包，每个包写这一版自己的下载地址、SHA-256、大小', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = (name: string, content: string) => {
    writeFileSync(join(directory, name), content);
    return join(directory, name);
  };
  const server = file('plasticine-server-2026.1105.093012.tar.gz', 'server');
  const installer = file('install.sh', '#!/bin/sh');
  const windows = file('Plasticine-Setup-2026.1105.093012.exe', 'exe');
  const serverManifest = JSON.stringify({ schema: 1, name: 'plasticine-server', version: '2026.1105.093012',
    commit: 'd'.repeat(40), builtAt: '2026-11-05T09:30:12.000Z', node: '>=24.11', releaseUrl: 'https://x.test',
    excluded: [] });
  const manifest = releaseManifest({ server, installer, windows }, serverManifest, BASE,
    new Date('2026-11-05T10:00:00Z'));
  assert.equal(manifest.version, '2026.1105.093012');
  assert.equal(manifest.commit, 'd'.repeat(40));
  assert.equal(manifest.nodeVersion, PACKAGE_NODE_VERSION);
  assert.equal(manifest.assets.server.url, `${BASE}/plasticine-server-2026.1105.093012.tar.gz`);
  assert.equal(manifest.assets.server.sha256, sha256Hex(readFileSync(server)));
  assert.equal(manifest.assets.windows?.size, 3);
  assert.equal(manifest.assets.mac, undefined);
});

test('Windows 构建脚本里的 Node 版本和 release-manifest.ts 一致', () => {
  const build = readFileSync('scripts/packages/windows/build.ps1', 'utf8');
  assert.match(build, new RegExp(`\\[string\\]\\$NodeVersion = "${PACKAGE_NODE_VERSION.replaceAll('.', '\\.')}"`));
});

test('工作流里写死的 Node 24 版本（有的话）都和 release-manifest.ts 一致', () => {
  const directory = '.github/workflows';
  const files = existsSync(directory) ? readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)) : [];
  for (const name of files) {
    const text = readFileSync(join(directory, name), 'utf8');
    const versions = [...text.matchAll(/\b24\.\d+\.\d+\b/g)].map((match) => match[0]);
    assert.deepEqual([...new Set(versions)].filter((version) => version !== PACKAGE_NODE_VERSION), [], name);
  }
});
