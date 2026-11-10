import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Workspace } from '../../src/artifacts/index.ts';
import { tempDirectory } from '../state/helpers.ts';

test('永久删除回收文件夹只删回收正文，留删除记录，重试不误删别的文件', async (t) => {
  const dir = await tempDirectory();
  t.after(() => dir.cleanup());
  const workspace = new Workspace(dir.directory, () => new Date('2026-11-11T00:00:00Z'));
  workspace.mkdir('资料');
  workspace.upload('资料', '一.txt', Buffer.from('正文一'), false);
  workspace.upload('资料', '二.txt', Buffer.from('正文二'), false);
  const outside = join(dir.directory, '保留.txt');
  writeFileSync(outside, '保留的正文');
  symlinkSync(outside, join(dir.directory, 'files', '资料', '外部链接'));
  const trashed = workspace.trash('资料', '资料');
  workspace.purge(trashed.id);
  workspace.purge(trashed.id);
  assert.deepEqual(workspace.trashed(), []);
  assert.equal(existsSync(join(dir.directory, 'files-trash', trashed.id)), false);
  assert.equal(readFileSync(outside, 'utf8'), '保留的正文');
  const record = JSON.parse(readFileSync(join(dir.directory, 'files-trash', `${trashed.id}.json`), 'utf8'));
  assert.equal(record.purgedAt, '2026-11-11T00:00:00.000Z');
  assert.equal(record.name, undefined);
  assert.throws(() => workspace.restore(trashed.id));
  assert.throws(() => workspace.purge('../保留.txt'));
});
