import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scanTests } from './scan-tests.ts';

test('整份源码扫描发现跨行和链式的独占测试，并报告起始行', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-scan-'));
  const file = join(directory, 'focus.test.ts');
  const calls = [
    ['test', 'only'].join('.'),
    ['it', 'only'].join('\n  .\n'),
    ['test', 'concurrent', 'only'].join('.'),
    ['describe', 'only', 'each'].join('.'),
  ];
  for (const call of calls) {
    writeFileSync(file, `// 前言\n${call}\n('用例', () => {});\n`);
    const result = scanTests([directory]);
    assert.equal(result.problems.length, 1, call);
    assert.match(result.problems[0] ?? '', /focus\.test\.ts:2 /);
  }
});

test('只忽略不存在的扫描目录，目录读取错误必须抛出', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-scan-'));
  assert.deepEqual(scanTests([join(directory, 'missing')]), { files: 0, problems: [] });
  const file = join(directory, 'not-a-directory');
  writeFileSync(file, '普通文件');
  assert.throws(() => scanTests([file]), /读取测试目录失败/);
});

test('扫描仍识别密钥形状而不输出命中的内容', () => {
  const directory = mkdtempSync(join(tmpdir(), 'plasticine-scan-'));
  const synthetic = ['sk', 'x'.repeat(40)].join('-');
  writeFileSync(join(directory, 'shape.test.ts'), `// 测试\nconst value = '${synthetic}';\n`);
  const result = scanTests([directory]);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0] ?? '', /shape\.test\.ts:2 .*OpenAI/);
  assert.ok(!result.problems.join('\n').includes(synthetic));
});
