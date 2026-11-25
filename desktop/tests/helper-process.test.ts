import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { HelperCallError } from '../../agent/shared/desktop-helper-client.ts';
import { HelperProcess, HelperUnavailable } from '../src/helper/helper-process.ts';
import { spawnFakeHelper, tempDir } from './helpers.ts';

function helper(roots: string[], mode = ''): HelperProcess {
  return new HelperProcess({ spawn: () => spawnFakeHelper(mode), roots: () => roots, log: () => undefined });
}

test('spawns helper lazily, sends authorized dirs first, and correlates receipts by id', async (t) => {
  const dir = tempDir(t);
  const process = helper([dir]);
  t.after(() => process.stop());
  writeFileSync(join(dir, 'a.txt'), '你好');
  const read = await process.call('files.read', { path: join(dir, 'a.txt') });
  assert.equal(read.content, '你好');
  await assert.rejects(process.call('files.read', { path: '/etc/hostname' }),
    (error: unknown) => error instanceof HelperCallError && error.code === 'refused');
});

test('reports capabilities by OS perms: hides click without accessibility, calendar without full', async (t) => {
  const process = helper(['/']);
  t.after(() => process.stop());
  const kinds = await process.capabilities();
  assert.ok(kinds.includes('screen_capture'));
  assert.ok(kinds.includes('file_read'));
  assert.ok(!kinds.includes('input_click'));
  assert.ok(!kinds.includes('calendar_list'));
  assert.ok((await process.methods()).includes('command.run'));
});

test('helper crash mid-call returns unknown outcome for in-flight calls and respawns on next call', async (t) => {
  const crashing = helper(['/'], 'crash');
  t.after(() => crashing.stop());
  await assert.rejects(crashing.call('screenshot', {}),
    (error: unknown) => error instanceof HelperCallError && error.code === 'closed');
  await assert.rejects(crashing.call('screenshot', {}), HelperCallError);
});

test('missing helper reports clearly with empty capability set', async () => {
  const missing = new HelperProcess({ spawn: () => { throw new HelperUnavailable('这个安装包没有带系统助手。'); },
    roots: () => [], log: () => undefined });
  await assert.rejects(missing.call('screenshot', {}), HelperUnavailable);
  assert.deepEqual(await missing.capabilities(), []);
});
