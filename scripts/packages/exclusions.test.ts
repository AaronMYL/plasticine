import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyEdit, applyExclusions, EXCLUSIONS_DOC, excludedPaths, RELAY_EDITS, runtimeImportsOf }
  from './exclusions.ts';

function scratch(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-exclusions-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('排除清单读的是文档表格第一列：中继本体、测试、只给中继用的部署文件', () => {
  const paths = excludedPaths(readFileSync(EXCLUSIONS_DOC, 'utf8'));
  assert.deepEqual(paths.slice(0, 4), ['agent/src/network-relay/', 'agent/tests/network-relay/',
    'agent/deploy/cyberhunter-relay.service', 'agent/deploy/plasticine-app.service.d/network.conf']);
  assert.ok(paths.includes('scripts/deploy-relay.ts'));
  assert.throws(() => excludedPaths('# 空文档'), /没读到排除清单/);
});

test('改动原文要恰好出现一次，对不上就失败', () => {
  assert.equal(applyEdit('a\nb\n', { file: 'x.ts', find: 'b\n', replace: '' }), 'a\n');
  assert.throws(() => applyEdit('a\n', { file: 'x.ts', find: 'b', replace: '' }), /x\.ts 里没有恰好一处/);
  assert.throws(() => applyEdit('b b', { file: 'x.ts', find: 'b', replace: '' }), /恰好一处/);
});

test('中继独立以后不再需要改源码副本', () => {
  assert.deepEqual(RELAY_EDITS, []);
});

test('在当前源码的副本上排除中继：文件删掉、运行时 import 清干净，类型 import 留着', (t) => {
  const root = scratch(t);
  cpSync('agent/src', join(root, 'agent/src'), { recursive: true });
  mkdirSync(join(root, 'agent/tests/network-relay'), { recursive: true });
  const excluded = applyExclusions(root, readFileSync(EXCLUSIONS_DOC, 'utf8'));
  assert.ok(excluded.includes('agent/src/network-relay/'));
  assert.equal(existsSync(join(root, 'agent/src/network-relay')), false);
  assert.equal(existsSync(join(root, 'agent/tests/network-relay')), false);
  assert.equal(existsSync(join(root, 'agent/src/network/tunnel-client.ts')), true);
  assert.deepEqual(runtimeImportsOf(join(root, 'agent'), excluded), []);
});

test('还有运行时 import 指向被排除的文件就报出来', (t) => {
  const root = scratch(t);
  mkdirSync(join(root, 'agent/src/app'), { recursive: true });
  writeFileSync(join(root, 'agent/src/app/a.ts'), "import type { X } from '../network-relay/index.ts';\n"
    + "import {\n  openRelay,\n} from '../network-relay/index.ts';\n");
  assert.deepEqual(runtimeImportsOf(join(root, 'agent'), ['agent/src/network-relay/']),
    ['src/app/a.ts → ../network-relay/index.ts']);
});
