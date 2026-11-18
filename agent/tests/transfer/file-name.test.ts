import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNamer, safeFileName } from '../../src/transfer/file-name.ts';

test('文件名去掉系统不认的字，空的用兜底名，太长的截短', () => {
  assert.equal(safeFileName('周末 / 去哪: 西湖?', '未命名'), '周末 去哪 西湖');
  assert.equal(safeFileName('  ...  ', '未命名'), '未命名');
  assert.equal(safeFileName('CON', '未命名'), '_CON');
  assert.equal(safeFileName('结尾有点. ', '未命名'), '结尾有点');
  assert.equal(Array.from(safeFileName('长'.repeat(200), '未命名')).length, 80);
});

test('同一个目录里重名的往后排号，大小写不同也算重名；不同目录互不影响', () => {
  const name = createNamer();
  assert.equal(name('', '计划', 'md'), '计划.md');
  assert.equal(name('', '计划', 'md'), '计划 2.md');
  assert.equal(name('', 'Plan', 'md'), 'Plan.md');
  assert.equal(name('', 'plan', 'md'), 'plan 2.md');
  assert.equal(name('工作', '计划', 'md'), '工作/计划.md');
  assert.equal(name('', '计划', 'zip'), '计划.zip');
});
