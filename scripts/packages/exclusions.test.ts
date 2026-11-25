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

test('exclusion list reads first column of doc table: relay code, tests, and relay-only deploy files', () => {
  const paths = excludedPaths(readFileSync(EXCLUSIONS_DOC, 'utf8'));
  assert.deepEqual(paths.slice(0, 4), ['agent/src/network-relay/', 'agent/tests/network-relay/',
    'agent/deploy/cyberhunter-relay.service', 'agent/deploy/plasticine-app.service.d/network.conf']);
  assert.ok(paths.includes('scripts/deploy-relay.ts'));
  assert.throws(() => excludedPaths('# 空文档'), /没读到排除清单/);
});

test('patch target text must match exactly once or fail', () => {
  assert.equal(applyEdit('a\nb\n', { file: 'x.ts', find: 'b\n', replace: '' }), 'a\n');
  assert.throws(() => applyEdit('a\n', { file: 'x.ts', find: 'b', replace: '' }), /x\.ts 里没有恰好一处/);
  assert.throws(() => applyEdit('b b', { file: 'x.ts', find: 'b', replace: '' }), /恰好一处/);
});

test('needs no source copy patches after relay separation', () => {
  assert.deepEqual(RELAY_EDITS, []);
});

test('strips relay files and runtime imports on source copy while preserving type-only imports', (t) => {
  const root = scratch(t);
  cpSync('agent/src', join(root, 'agent/src'), { recursive: true });
  mkdirSync(join(root, 'agent/tests/network-relay'), { recursive: true });
  const excluded = applyExclusions(root, readFileSync(EXCLUSIONS_DOC, 'utf8'));
  assert.ok(excluded.includes('agent/src/network-relay/'));
  assert.equal(existsSync(join(root, 'agent/src/network-relay')), false);
  assert.equal(existsSync(join(root, 'agent/tests/network-relay')), false);
  assert.equal(existsSync(join(root, 'agent/src/network/tunnel.ts')), true);
  assert.deepEqual(runtimeImportsOf(join(root, 'agent'), excluded), []);
});

test('reports any remaining runtime import pointing to an excluded file', (t) => {
  const root = scratch(t);
  mkdirSync(join(root, 'agent/src/app'), { recursive: true });
  writeFileSync(join(root, 'agent/src/app/a.ts'), "import type { X } from '../network-relay/index.ts';\n"
    + "import {\n  openRelay,\n} from '../network-relay/index.ts';\n");
  assert.deepEqual(runtimeImportsOf(join(root, 'agent'), ['agent/src/network-relay/']),
    ['src/app/a.ts → ../network-relay/index.ts']);
});
