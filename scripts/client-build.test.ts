import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'vite';

test('同一提交在不同时间构建，清单和产物逐字节相同', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-build-repro-'));
  const previousId = process.env['PLASTICINE_BUILD_ID'];
  process.env['PLASTICINE_BUILD_ID'] = 'reproducible-test';
  try {
    for (const name of ['first', 'second']) {
      await build({ root: resolve('client'), logLevel: 'silent', build: { outDir: join(directory, name) } });
    }
    const first = readFileSync(join(directory, 'first/client-manifest.json'), 'utf8');
    const second = readFileSync(join(directory, 'second/client-manifest.json'), 'utf8');
    assert.equal(second, first);
    const manifest = JSON.parse(first) as { assets: { path: string }[] };
    for (const asset of manifest.assets) {
      assert.deepEqual(readFileSync(join(directory, 'first', asset.path)),
        readFileSync(join(directory, 'second', asset.path)));
    }
  } finally {
    if (previousId === undefined) {
      delete process.env['PLASTICINE_BUILD_ID'];
    } else {
      process.env['PLASTICINE_BUILD_ID'] = previousId;
    }
    // 测试只清自己在 TEMP 新建的输出目录。
    assert.ok(directory.startsWith(join(tmpdir(), 'plasticine-build-repro-')));
    rmSync(directory, { recursive: true, force: true });
  }
});
