import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { authorizedPath, expandPath, PathRefused, realPathSystem, resolveReal, within,
  type PathSystem } from '../src/node/path-policy.ts';
import { tempDir } from './helpers.ts';

test('~ 展开到家目录，相对路径和空字符不收', () => {
  const system = realPathSystem('linux', '/home/a');
  assert.equal(expandPath('~/x/../y', system), '/home/a/y');
  assert.equal(expandPath('~', system), '/home/a');
  assert.throws(() => expandPath('x/y', system), PathRefused);
  assert.throws(() => expandPath('/a\u0000b', system), PathRefused);
});

test('Windows：~/ 和 /C:/ 换成本机写法，比较不分大小写', () => {
  const system: PathSystem = { ...realPathSystem('win32', 'C:\\Users\\a'), platform: 'win32' };
  assert.equal(expandPath('~/Documents/a.txt', system), 'C:\\Users\\a\\Documents\\a.txt');
  assert.equal(expandPath('/C:/Work/x', system), 'C:\\Work\\x');
  assert.equal(expandPath('d:/x', system), 'd:\\x');
  assert.throws(() => expandPath('/usr/bin', system), PathRefused);
  assert.ok(within('c:\\users\\A\\doc', 'C:\\Users\\a', system));
  assert.ok(!within('C:\\Users\\ab', 'C:\\Users\\a', system));
});

test('悬空的符号链接按它指向的地方判，跳不出授权目录', (t) => {
  const dir = realpathSync(tempDir(t));
  const inside = join(dir, 'inside');
  const outside = join(dir, 'outside');
  mkdirSync(inside);
  mkdirSync(outside);
  writeFileSync(join(inside, 'ok.txt'), '');
  symlinkSync(join(outside, 'not-yet.txt'), join(inside, 'dangling'));
  const system = realPathSystem('linux', dir);
  assert.equal(resolveReal(join(inside, 'dangling'), system), join(outside, 'not-yet.txt'));
  assert.equal(resolveReal(join(inside, 'new', 'file.txt'), system), join(inside, 'new', 'file.txt'));
  assert.equal(authorizedPath(join(inside, 'ok.txt'), [inside], [], system), join(inside, 'ok.txt'));
  assert.throws(() => authorizedPath(join(inside, 'dangling'), [inside], [], system), /不在这台电脑授权的目录里/);
});

test('两层授权都要过：本机没授权、上限目录之外都拒', (t) => {
  const dir = realpathSync(tempDir(t));
  mkdirSync(join(dir, 'a'));
  mkdirSync(join(dir, 'b'));
  const system = realPathSystem('linux', dir);
  assert.throws(() => authorizedPath(join(dir, 'a'), [], [], system), /没有授权任何目录/);
  assert.throws(() => authorizedPath(join(dir, 'a', 'x'), [dir], [join(dir, 'b')], system), /设备上限/);
  assert.equal(authorizedPath('~/a/x', ['~'], [join(dir, 'a')], system), join(dir, 'a', 'x'));
});
