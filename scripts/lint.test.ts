import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('lint 传文件时只检查这些文件，仍会拒绝所选文件的空 catch', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'plasticine-lint-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const good = join(directory, 'good.ts');
  const bad = join(directory, 'bad.tsx');
  await writeFile(good, 'export const value = 1;\n');
  await writeFile(bad, 'try { act(); } catch {}\n');
  const lint = (...files: string[]) => spawnSync(process.execPath,
    [fileURLToPath(new URL('./lint.ts', import.meta.url)), ...files], { encoding: 'utf8', timeout: 10_000 });
  const passed = lint(good);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.stderr, '');
  const failed = lint(good, bad);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /bad.tsx/);
  assert.match(failed.stderr, /empty-catch/);
});
