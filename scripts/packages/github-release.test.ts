import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDesktopManifest } from '../../agent/shared/desktop-release.ts';
import { assetBase, buildGithubRelease } from './github-release.ts';
import { parseReleaseManifest, sha256Hex } from './release-manifest.ts';

const VERSION = '2026.1109.170018';
const COMMIT = 'c'.repeat(40);
const REPO = 'example/plasticine';

function scratch(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-github-release-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function build(root: string): { artifacts: string; desktop: string } {
  const artifacts = join(root, 'artifacts');
  const desktop = join(root, 'desktop');
  mkdirSync(artifacts);
  mkdirSync(desktop);
  writeFileSync(join(artifacts, `plasticine-server-${VERSION}.tar.gz`), 'server');
  writeFileSync(join(artifacts, 'install.sh'), '#!/bin/sh\n');
  writeFileSync(join(artifacts, `Plasticine-mac-${VERSION}.zip`), 'mac');
  writeFileSync(join(artifacts, `Plasticine-Setup-${VERSION}.exe`), 'exe');
  writeFileSync(join(artifacts, 'mac-package.json'), '{}');
  writeFileSync(join(artifacts, 'server-manifest.json'), JSON.stringify({ schema: 1, name: 'plasticine-server',
    version: VERSION, commit: COMMIT, builtAt: '2026-11-09T17:00:18.000Z', node: '>=24.11',
    releaseUrl: 'https://cyberhunter.top/download', excluded: [] }));
  writeFileSync(join(desktop, `Plasticine-Desktop-mac-${VERSION}.zip`), 'desktop zip');
  writeFileSync(join(desktop, `Plasticine-Desktop-mac-${VERSION}.dmg`), 'desktop dmg');
  writeFileSync(join(desktop, `Plasticine-Desktop-Setup-${VERSION}.exe`), 'desktop exe');
  return { artifacts, desktop };
}

test('附件地址是 GitHub 给的固定下载地址，标签 v<版本>', () => {
  assert.equal(assetBase(REPO, VERSION), `https://github.com/${REPO}/releases/download/v${VERSION}/`);
  assert.throws(() => assetBase('not a repo', VERSION), /仓库名不对/);
});

test('一版整理成附件：七个包 + Mac 身份记录 + 两份清单，清单里的地址都指向这个 Release，校验值对得上', (t) => {
  const root = scratch(t);
  const out = join(root, 'release');
  const result = buildGithubRelease({ ...build(root), commit: COMMIT, repo: REPO, out,
    now: new Date('2026-11-09T17:10:00Z') });
  assert.equal(result.tag, `v${VERSION}`);
  assert.equal(result.files.length, 10);
  const base = assetBase(REPO, VERSION);
  const manifest = parseReleaseManifest(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.commit, COMMIT);
  assert.equal(manifest.assets.server.url, `${base}plasticine-server-${VERSION}.tar.gz`);
  assert.equal(manifest.assets.linuxInstaller.url, `${base}install.sh`);
  const desktop = parseDesktopManifest(readFileSync(join(out, 'desktop.json'), 'utf8'));
  assert.equal(desktop.assets.windows?.url, `${base}Plasticine-Desktop-Setup-${VERSION}.exe`);
  assert.equal(desktop.assets.macDisk?.sha256, sha256Hex(Buffer.from('desktop dmg')));
  for (const name of result.files) readFileSync(join(out, name));
});

test('提交对不上、少一个桌面包，都不发布', (t) => {
  const root = scratch(t);
  const paths = build(root);
  assert.throws(() => buildGithubRelease({ ...paths, commit: 'd'.repeat(40), repo: REPO, out: join(root, 'a') }),
    /提交.*对不上/);
  rmSync(join(paths.desktop, `Plasticine-Desktop-mac-${VERSION}.dmg`));
  assert.throws(() => buildGithubRelease({ ...paths, commit: COMMIT, repo: REPO, out: join(root, 'b') }),
    /缺桌面包/);
});
