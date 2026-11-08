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
    fetchBytes: async (url) => {
      fetched.push(url);
      return url.endsWith('desktop.json') ? new TextEncoder().encode(text) : ZIP;
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

test('有新版：读 desktop.json、按清单所在位置下载、核对后等他点重新打开', async (t) => {
  const dir = tempDir(t);
  const { updates, fetched, launched, quits } = manager(dir, manifest('2026.1108.000000'));
  const status = await updates.check();
  assert.equal(status.state, 'ready');
  assert.equal(status.available, '2026.1108.0');
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

test('发布版本号带前导零、安装包里的去掉了前导零：认成同一版', async (t) => {
  const { updates } = manager(tempDir(t), manifest('2026.1101.000000'), { version: '2026.1101.0' });
  assert.equal((await updates.check()).state, 'up_to_date');
  const next = manager(tempDir(t), manifest('2026.1108.093012'), { version: '2026.1101.0' });
  const status = await next.updates.check();
  assert.equal(status.available, '2026.1108.93012');
});

test('一样新、被记成坏版本的不装；大小或摘要对不上不装', async (t) => {
  const same = manager(tempDir(t), manifest('2026.1101.000000'));
  assert.equal((await same.updates.check()).state, 'up_to_date');
  const bad = manager(tempDir(t), manifest('2026.1108.000000', 'b'.repeat(64)));
  const status = await bad.updates.check();
  assert.equal(status.state, 'failed');
  assert.match(status.problem ?? '', /SHA-256/);
});

test('上次装上的新版没起来被退回：这次启动记下来，以后不再自动装它', async (t) => {
  const dir = tempDir(t);
  mkdirSync(join(dir, 'updates'), { recursive: true });
  writeFileSync(join(dir, 'updates', 'rolled-back.json'), JSON.stringify({ failed: '2026.1108.000000' }));
  const { updates } = manager(dir, manifest('2026.1108.000000'));
  updates.started();
  assert.ok(existsSync(join(dir, 'updates', 'started-2026.1101.0')));
  assert.match(updates.status().problem ?? '', /没起来，已退回/);
  assert.equal((await updates.check()).state, 'up_to_date');
});

test('没有上一版时退回说清楚；开发版不查', async (t) => {
  const { updates } = manager(tempDir(t), manifest('2026.1108.000000'));
  updates.rollback();
  assert.match(updates.status().problem ?? '', /没有可以退回的上一版/);
  const dev = manager(tempDir(t), manifest('2026.1108.000000'), { packaged: false });
  assert.match((await dev.updates.check()).problem ?? '', /开发版/);
  assert.deepEqual(dev.fetched, []);
});
