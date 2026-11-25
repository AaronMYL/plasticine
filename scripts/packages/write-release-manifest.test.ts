import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE_NODE_VERSION, sha256Hex } from './release-manifest.ts';
import { releaseManifest } from './write-release-manifest.ts';

const BASE = 'https://cyberhunter.top/download/2026.1105.093012';

test('manifest takes version/commit from agent archive with per-package URL, SHA-256, and size', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = (name: string, content: string) => {
    writeFileSync(join(directory, name), content);
    return join(directory, name);
  };
  const server = file('plasticine-server-2026.1105.093012.tar.gz', 'server');
  const installer = file('install.sh', '#!/bin/sh');
  const serverManifest = JSON.stringify({ schema: 1, name: 'plasticine-server', version: '2026.1105.093012',
    commit: 'd'.repeat(40), builtAt: '2026-11-05T09:30:12.000Z', node: '>=24.11', releaseUrl: 'https://x.test',
    excluded: [] });
  const manifest = releaseManifest({ server, installer }, serverManifest, BASE,
    new Date('2026-11-05T10:00:00Z'));
  assert.equal(manifest.version, '2026.1105.093012');
  assert.equal(manifest.commit, 'd'.repeat(40));
  assert.equal(manifest.nodeVersion, PACKAGE_NODE_VERSION);
  assert.equal(manifest.assets.server.url, `${BASE}/plasticine-server-2026.1105.093012.tar.gz`);
  assert.equal(manifest.assets.server.sha256, sha256Hex(readFileSync(server)));
  assert.equal(manifest.assets.linuxInstaller.size, 9);
  assert.deepEqual(Object.keys(manifest.assets), ['server', 'linuxInstaller']);
});

test('hardcoded Node 24 versions in workflows match release-manifest.ts', () => {
  const directory = '.github/workflows';
  const files = existsSync(directory) ? readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)) : [];
  for (const name of files) {
    const text = readFileSync(join(directory, name), 'utf8');
    const versions = [...text.matchAll(/\b24\.\d+\.\d+\b/g)].map((match) => match[0]);
    assert.deepEqual([...new Set(versions)].filter((version) => version !== PACKAGE_NODE_VERSION), [], name);
  }
});
