import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseDesktopManifest } from '../../agent/shared/desktop-release.ts';
import { desktopFiles, publishDesktop, verifyDesktop } from './publish-desktop.ts';

const COMMIT = 'a'.repeat(40);

function setup(t: { after(fn: () => void): void }, version: string, content = 'mac zip') {
  const dir = mkdtempSync(join(tmpdir(), 'publish-desktop-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const artifacts = join(dir, 'artifacts');
  mkdirSync(artifacts);
  writeFileSync(join(artifacts, desktopFiles(version).mac), content);
  writeFileSync(join(artifacts, desktopFiles(version).windows), 'win setup');
  return { dir, artifacts, root: join(dir, 'root') };
}

test('桌面包放进版本目录、写 desktop.json，不碰 manifest.json', (t) => {
  const { artifacts, root } = setup(t, '2026.1108.010203');
  const result = publishDesktop({ artifacts, version: '2026.1108.010203', commit: COMMIT, root,
    baseUrl: 'https://cyberhunter.top/download', now: new Date('2026-11-08T00:00:00Z') });
  assert.deepEqual(result?.assets, ['mac', 'windows']);
  const manifest = parseDesktopManifest(readFileSync(join(root, 'desktop.json'), 'utf8'));
  assert.equal(manifest.assets.mac?.url,
    'https://cyberhunter.top/download/2026.1108.010203/Plasticine-Desktop-mac-2026.1108.010203.zip');
  assert.equal(manifest.assets.macDisk, undefined);
  assert.equal(readFileSync(join(root, '2026.1108.010203', 'Plasticine-Desktop-Setup-2026.1108.010203.exe'), 'utf8'),
    'win setup');
  assert.throws(() => readFileSync(join(root, 'manifest.json')));
});

test('同一版原样重发不变；内容不一样、版本更旧都拒', (t) => {
  const first = setup(t, '2026.1108.010203');
  const options = { artifacts: first.artifacts, version: '2026.1108.010203', commit: COMMIT, root: first.root,
    baseUrl: 'https://cyberhunter.top/download', now: new Date('2026-11-08T00:00:00Z') };
  publishDesktop(options);
  assert.ok(publishDesktop({ ...options, now: new Date('2026-11-09T00:00:00Z') }) !== null);
  writeFileSync(join(first.artifacts, desktopFiles('2026.1108.010203').mac), 'changed');
  assert.throws(() => publishDesktop(options), /内容不一样/);
  const older = setup(t, '2026.1101.000000');
  assert.throws(() => publishDesktop({ ...options, artifacts: older.artifacts, version: '2026.1101.000000' }),
    /不比已发布的/);
});

test('这一版没有桌面包就什么都不做；公网读回不一样算没发成', async (t) => {
  const { dir, root } = setup(t, '2026.1108.010203');
  const empty = join(dir, 'empty');
  mkdirSync(empty);
  assert.equal(publishDesktop({ artifacts: empty, version: '2026.1108.010203', commit: COMMIT, root,
    baseUrl: 'https://cyberhunter.top/download' }), null);
  const { artifacts } = setup(t, '2026.1108.010203');
  const result = publishDesktop({ artifacts, version: '2026.1108.010203', commit: COMMIT, root,
    baseUrl: 'https://cyberhunter.top/download' });
  const text = readFileSync(result?.manifest ?? '', 'utf8');
  await verifyDesktop(result?.manifest ?? '', 'https://cyberhunter.top/download', async () => new Response(text));
  await assert.rejects(verifyDesktop(result?.manifest ?? '', 'https://cyberhunter.top/download',
    async () => new Response('{}')), /格式不对|不一样/);
});
