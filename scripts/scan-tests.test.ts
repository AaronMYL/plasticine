import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanTests } from './scan-tests.ts';

test('detects multiline and chained .only calls and reports their starting line', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-scan-'));
  const file = join(directory, 'focus.test.ts');
  const calls = [
    ['test', 'only'].join('.'),
    ['it', 'only'].join('\n  .\n'),
    ['test', 'concurrent', 'only'].join('.'),
    ['describe', 'only', 'each'].join('.'),
  ];
  for (const call of calls) {
    writeFileSync(file, `const seed = 1;\n${call}\n('case', () => {});\n`);
    const result = scanTests([directory]);
    assert.equal(result.problems.length, 1, call);
    assert.match(result.problems[0] ?? '', /focus\.test\.ts:2 /);
  }
});

test('ignores missing root directories while throwing on invalid directory paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-scan-'));
  assert.deepEqual(scanTests([join(directory, 'missing')]), { files: 0, problems: [] });
  const file = join(directory, 'not-a-directory');
  writeFileSync(file, 'plain file');
  assert.throws(() => scanTests([file]), /Failed to read test directory/);
});

test('detects secret shapes without echoing the matched secret value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-scan-'));
  const synthetic = ['sk', 'x'.repeat(40)].join('-');
  writeFileSync(join(directory, 'shape.test.ts'), `const seed = 1;\nconst value = '${synthetic}';\n`);
  const result = scanTests([directory]);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0] ?? '', /shape\.test\.ts:2 .*OpenAI/);
  assert.ok(!result.problems.join('\n').includes(synthetic));
});
