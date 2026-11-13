import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanUpdates, KEEP_COPIES, KEEP_MS } from '../src/updates/update-cleanup.ts';
import { tempDir } from './helpers.ts';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

function file(path: string, at?: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'x');
  if (at !== undefined) {
    utimesSync(path, new Date(at), new Date(at));
  }
}

test('规则是最多 2 份、每份 7 天', () => {
  assert.equal(KEEP_COPIES, 2);
  assert.equal(KEEP_MS, 7 * 24 * 60 * 60 * 1000);
});

test('装好的更新包、解包残留和别的版本的启动记号都清掉；下好还没装的那一版不动', (t) => {
  const dir = join(tempDir(t), 'updates');
  file(join(dir, 'downloads', '2026.1111.1', 'Plasticine-Desktop-mac-2026.1111.000001.zip'));
  file(join(dir, 'downloads', '2026.1112.1', 'Plasticine-Desktop-mac-2026.1112.000001.zip'));
  file(join(dir, 'downloads', '2026.1114.1', 'Plasticine-Desktop-mac-2026.1114.000001.zip'));
  file(join(dir, 'staging', '2026.1112.1', 'Plasticine.app', 'left'));
  file(join(dir, 'started-2026.1111.1'));
  file(join(dir, 'started-2026.1113.1'));
  file(join(dir, 'state.json'));
  const result = cleanUpdates({ directory: dir, platform: 'darwin', current: '2026.1113.1', holding: '2026.1114.1',
    createdAt: {}, now: NOW });
  assert.deepEqual(readdirSync(join(dir, 'downloads')), ['2026.1114.1']);
  assert.deepEqual(readdirSync(join(dir, 'staging')), []);
  assert.equal(existsSync(join(dir, 'started-2026.1111.1')), false);
  assert.equal(existsSync(join(dir, 'started-2026.1113.1')), true);
  assert.equal(existsSync(join(dir, 'state.json')), true);
  assert.equal(result.previousGone, false);
  assert.deepEqual(result.removed.toSorted(), ['downloads/2026.1111.1', 'downloads/2026.1112.1', 'staging/2026.1112.1',
    'started-2026.1111.1']);
});

test('Mac 的上一版：不满 7 天留着，满 7 天删掉并报「没有上一版了」；时间按登记的生成时间算，不看文件时间', (t) => {
  const dir = join(tempDir(t), 'updates');
  const marker = join(dir, 'previous', 'Plasticine.app', 'Contents', 'Info.plist');
  file(marker, daysAgo(0));
  const fresh = cleanUpdates({ directory: dir, platform: 'darwin', current: '2026.1113.1', holding: null,
    createdAt: { previous: daysAgo(6.9) }, now: NOW });
  assert.equal(existsSync(marker), true);
  assert.equal(fresh.previousGone, false);
  // 文件刚被碰过（修改时间是现在），登记的生成时间已经满 7 天：照登记的删。
  const expired = cleanUpdates({ directory: dir, platform: 'darwin', current: '2026.1113.1', holding: null,
    createdAt: { previous: daysAgo(7) }, now: NOW });
  assert.equal(existsSync(join(dir, 'previous')), false);
  assert.equal(expired.previousGone, true);
  assert.deepEqual(expired.removed, ['previous']);
});

test('老版本留下、没登记生成时间的上一版：按目录自己的修改时间算', (t) => {
  const dir = join(tempDir(t), 'updates');
  const app = join(dir, 'previous', 'Plasticine.app');
  file(join(app, 'Contents', 'Info.plist'));
  utimesSync(app, new Date(daysAgo(8)), new Date(daysAgo(8)));
  const result = cleanUpdates({ directory: dir, platform: 'darwin', current: '2026.1113.1', holding: null,
    createdAt: {}, now: NOW });
  assert.equal(existsSync(join(dir, 'previous')), false);
  assert.equal(result.previousGone, true);
});

test('Windows 的安装程序：只留最新 2 份，满 7 天的也删；上一版的那份没了就报「没有上一版了」', (t) => {
  const dir = join(tempDir(t), 'updates');
  for (const version of ['2026.1101.1', '2026.1110.1', '2026.1111.1', '2026.1112.1', '2026.1113.1']) {
    file(join(dir, 'installers', `${version}.exe`));
  }
  const createdAt = { 'installer:2026.1101.1': daysAgo(12), 'installer:2026.1110.1': daysAgo(3),
    'installer:2026.1111.1': daysAgo(2), 'installer:2026.1112.1': daysAgo(1), 'installer:2026.1113.1': daysAgo(0) };
  const result = cleanUpdates({ directory: dir, platform: 'win32', current: '2026.1113.1', holding: null,
    createdAt, now: NOW, previous: '2026.1112.1' });
  assert.deepEqual(readdirSync(join(dir, 'installers')).toSorted(), ['2026.1112.1.exe', '2026.1113.1.exe']);
  assert.equal(result.previousGone, false);
  // 过了 7 天又没有新版本：两份都到期，一份不留。
  const later = cleanUpdates({ directory: dir, platform: 'win32', current: '2026.1113.1', holding: null,
    createdAt, now: new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000), previous: '2026.1112.1' });
  assert.deepEqual(readdirSync(join(dir, 'installers')), []);
  assert.equal(later.previousGone, true);
});

test('坏版本退回的旧记录满 7 天清掉；没有更新目录时什么都不做', (t) => {
  const root = tempDir(t);
  assert.deepEqual(cleanUpdates({ directory: join(root, 'none'), platform: 'darwin', current: '1.0.0', holding: null,
    createdAt: {}, now: NOW }), { removed: [], previousGone: false });
  const dir = join(root, 'updates');
  const old = NOW.getTime() - 8 * 24 * 60 * 60 * 1000;
  const recent = NOW.getTime() - 60_000;
  file(join(dir, `rolled-back.json.${old}`));
  file(join(dir, `rolled-back.json.${recent}`));
  file(join(dir, 'rolled-back.json'));
  cleanUpdates({ directory: dir, platform: 'darwin', current: '1.0.0', holding: null, createdAt: {}, now: NOW });
  assert.deepEqual(readdirSync(dir).toSorted(), ['rolled-back.json', `rolled-back.json.${recent}`]);
});
