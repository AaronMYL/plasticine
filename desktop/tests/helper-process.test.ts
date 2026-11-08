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

test('第一次要用时拉起助手，先把授权目录告诉它，再按 id 认回执', async (t) => {
  const dir = tempDir(t);
  const process = helper([dir]);
  t.after(() => process.stop());
  writeFileSync(join(dir, 'a.txt'), '你好');
  const read = await process.call('files.read', { path: join(dir, 'a.txt') });
  assert.equal(read.content, '你好');
  await assert.rejects(process.call('files.read', { path: '/etc/hostname' }),
    (error: unknown) => error instanceof HelperCallError && error.code === 'refused');
});

test('按系统权限报能力：没给辅助功能不报点按，日历没完全访问不报日历', async (t) => {
  const process = helper(['/']);
  t.after(() => process.stop());
  const kinds = await process.capabilities();
  assert.ok(kinds.includes('screen_capture'));
  assert.ok(kinds.includes('file_read'));
  assert.ok(!kinds.includes('input_click'));
  assert.ok(!kinds.includes('calendar_list'));
  assert.ok((await process.methods()).includes('command.run'));
});

test('助手中途退出：在路上的调用按说不清做没做交回，下一次再拉起', async (t) => {
  const crashing = helper(['/'], 'crash');
  t.after(() => crashing.stop());
  await assert.rejects(crashing.call('screenshot', {}),
    (error: unknown) => error instanceof HelperCallError && error.code === 'closed');
  await assert.rejects(crashing.call('screenshot', {}), HelperCallError);
});

test('没带助手：说清楚，能力是空的', async () => {
  const missing = new HelperProcess({ spawn: () => { throw new HelperUnavailable('这个安装包没有带系统助手。'); },
    roots: () => [], log: () => undefined });
  await assert.rejects(missing.call('screenshot', {}), HelperUnavailable);
  assert.deepEqual(await missing.capabilities(), []);
});
