import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { UpdateManager, type UpdateDeps } from '../src/updates/update-manager.ts';
import { tempDir } from './helpers.ts';

const ZIP = Buffer.from('fake zip bytes');

function manifest(version: string, sha = createHash('sha256').update(ZIP).digest('hex')): string {
  const name = `Plasticine-Desktop-mac-${version}.zip`;
  const asset = { name, url: `${version}/${name}`,
    sha256: sha, size: ZIP.length };
  return JSON.stringify({ schema: 1, version, commit: 'a'.repeat(40), publishedAt: '2026-11-08T00:00:00.000Z',
    assets: { mac: asset } });
}

function manager(dir: string, text: string, change: Partial<UpdateDeps> = {}) {
  const launched: { file: string; args: readonly string[] }[] = [];
  const fetched: string[] = [];
  let quit = 0;
  const updates = new UpdateManager({
    platform: 'darwin', version: '2026.1101.000000', packaged: true, releaseUrl: 'https://cyberhunter.top/download',
    directory: join(dir, 'updates'), installed: join(dir, 'Plasticine.app'), pid: 1,
    fetchBytes: async (url, onProgress) => {
      fetched.push(url);
      if (url.endsWith('desktop.json')) return new TextEncoder().encode(text);
      onProgress?.(4);
      onProgress?.(ZIP.length);
      return ZIP;
    },
    extractZip: async (_zip, into) => {
      mkdirSync(join(into, 'Plasticine.app', 'Contents'), { recursive: true });
    },
    resign: async () => undefined,
    launchDetached: (file, args) => launched.push({ file, args }),
    quit: () => { quit += 1; },
    now: () => new Date('2026-11-08T00:00:00.000Z'),
    log: () => undefined,
    ...change,
  });
  return { updates, launched, fetched, quits: () => quit };
}

test('check reports available without downloading; user action downloads, verifies, installs, reopens', async (t) => {
  const dir = tempDir(t);
  const { updates, fetched, launched, quits } = manager(dir, manifest('2026.1108.000000'));
  const found = await updates.check();
  assert.equal(found.state, 'available');
  assert.equal(found.available, '2026.1108.0');
  assert.deepEqual(fetched, ['https://cyberhunter.top/download/desktop.json']);
  const seen: (number | undefined)[] = [];
  updates.onChange((status) => { if (status.state === 'downloading') seen.push(status.progress?.received); });
  const status = await updates.download();
  assert.equal(status.state, 'ready');
  assert.equal(status.progress, null);
  assert.deepEqual(seen.filter((value) => value !== undefined), [0, 4, ZIP.length]);
  assert.deepEqual(fetched, ['https://cyberhunter.top/download/desktop.json',
    'https://cyberhunter.top/download/2026.1108.000000/Plasticine-Desktop-mac-2026.1108.000000.zip']);
  updates.install();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(quits(), 1);
  assert.equal(launched[0]?.file, '/bin/sh');
  const script = readFileSync(String(launched[0]?.args[0]), 'utf8');
  assert.match(script, /mv "\$APP\/Contents" "\$PREVIOUS\.new\/Contents"/);
  assert.equal(updates.status().previous, '2026.1101.0');
});

test('treats release version with leading zeros and package version without as the same version', async (t) => {
  const { updates } = manager(tempDir(t), manifest('2026.1101.000000'), { version: '2026.1101.0' });
  assert.equal((await updates.check()).state, 'up_to_date');
  const next = manager(tempDir(t), manifest('2026.1108.093012'), { version: '2026.1101.0' });
  const status = await next.updates.check();
  assert.equal(status.available, '2026.1108.93012');
});

test('skips same version, known bad version, or size/hash mismatch', async (t) => {
  const same = manager(tempDir(t), manifest('2026.1101.000000'));
  assert.equal((await same.updates.check()).state, 'up_to_date');
  const bad = manager(tempDir(t), manifest('2026.1108.000000', 'b'.repeat(64)));
  assert.equal((await bad.updates.check()).state, 'available');
  const status = await bad.updates.download();
  assert.equal(status.state, 'failed');
  assert.equal(status.available, '2026.1108.0', '没下成还记着那一版，点了能重试');
  assert.match(status.problem ?? '', /SHA-256/);
});

test('records rolled-back new version on next launch so it is not auto-installed again', async (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'updates'), { recursive: true });
  writeFileSync(join(dir, 'updates', 'rolled-back.json'), JSON.stringify({ failed: '2026.1108.000000' }));
  const { updates } = manager(dir, manifest('2026.1108.000000'));
  updates.started();
  assert.ok(existsSync(join(dir, 'updates', 'started-2026.1101.0')));
  assert.match(updates.status().problem ?? '', /没起来，已退回/);
  assert.equal((await updates.check()).state, 'up_to_date');
});

test('explains when no previous version exists to roll back and skips checks on dev builds', async (t) => {
  const { updates } = manager(tempDir(t), manifest('2026.1108.000000'));
  updates.rollback();
  assert.match(updates.status().problem ?? '', /没有可以退回的上一版/);
  const dev = manager(tempDir(t), manifest('2026.1108.000000'), { packaged: false });
  assert.match((await dev.updates.check()).problem ?? '', /开发版/);
  assert.deepEqual(dev.fetched, []);
});

test('cleans installed update package on startup and expires 7-day previous version', (t) => {
  const dir = tempDir(t);
  const root = join(dir, 'updates');
  mkdirSync(join(root, 'downloads', '2026.1030.1'), { recursive: true });
  writeFileSync(join(root, 'downloads', '2026.1030.1', 'Plasticine-Desktop-mac-2026.1030.000001.zip'), ZIP);
  mkdirSync(join(root, 'previous', 'Plasticine.app', 'Contents'), { recursive: true });
  writeFileSync(join(root, 'state.json'), JSON.stringify({ skipped: [], previous: '2026.1030.1', checkedAt: null,
    problem: null, created: { previous: '2026-11-07T00:00:00.000Z' } }));
  const lines: string[] = [];
  const { updates } = manager(dir, manifest('2026.1101.000000'), { log: (line) => lines.push(line) });
  updates.started();
  assert.equal(existsSync(join(root, 'downloads', '2026.1030.1')), false);
  assert.equal(existsSync(join(root, 'previous', 'Plasticine.app')), true, '上一版才 1 天，留着');
  assert.equal(updates.status().previous, '2026.1030.1');
  assert.match(lines.join('\n'), /清掉了用不上的更新文件：downloads\/2026\.1030\.1/);
  const later = manager(dir, manifest('2026.1101.000000'), { now: () => new Date('2026-11-14T00:00:00.000Z') });
  later.updates.started();
  assert.equal(existsSync(join(root, 'previous')), false);
  assert.equal(later.updates.status().previous, null);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')).created, {});
});
