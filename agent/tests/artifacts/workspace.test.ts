import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { ArtifactError, UPLOAD_MAX_BYTES, Workspace } from '../../src/artifacts/index.ts';
import { tempDirectory } from '../state/helpers.ts';

let dir: Awaited<ReturnType<typeof tempDirectory>>;
let workspace: Workspace;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(async () => {
  dir = await tempDirectory();
  workspace = new Workspace(dir.directory, () => new Date('2026-10-27T01:00:00Z'));
});

afterEach(async () => {
  await dir.cleanup();
});

function code(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof ArtifactError, String(error));
    return error.code;
  }
  return 'none';
}

test('根目录在状态目录的 files/ 里；文件夹在前、按名字排', () => {
  workspace.mkdir('报告');
  workspace.upload('', 'a.md', Buffer.from('# A'), false);
  const listing = workspace.list('');
  assert.deepEqual(listing.entries.map((entry) => [entry.name, entry.kind]), [['报告', 'directory'], ['a.md', 'file']]);
  assert.equal(listing.parent, null);
  assert.equal(readFileSync(join(dir.directory, 'files', 'a.md'), 'utf8'), '# A');
});

test('相对路径拒绝歧义段，绝对路径可访问服务器位置', () => {
  for (const path of ['..', '../plasticine.sqlite', 'a/../../x', 'C:/x', 'a\\b', 'a\0b', 'a//b']) {
    assert.equal(code(() => workspace.list(path)), 'invalid_input', path);
  }
  assert.equal(code(() => workspace.upload('', '../x.md', Buffer.from('x'), false)), 'invalid_input');
});

test('服务器文件可从绝对路径和工作目录符号链接读取', () => {
  mkdirSync(join(dir.directory, 'files'), { recursive: true });
  mkdirSync(join(dir.directory, 'secret'));
  writeFileSync(join(dir.directory, 'secret', 'key.txt'), 'x');
  symlinkSync(join(dir.directory, 'secret'), join(dir.directory, 'files', 'link'), 'junction');
  assert.equal(workspace.read('link/key.txt').data.toString(), 'x');
  assert.equal(workspace.list(join(dir.directory, 'secret')).entries[0]?.name, 'key.txt');
  assert.ok(workspace.list('link').freeBytes > 0);
});

test('上传：只收认得的类型，开头的字节要对得上，文字类不许有 NUL，最多 20 MB；同名不覆盖', () => {
  assert.equal(workspace.upload('', '图.png', PNG, false).type, 'image/png');
  assert.equal(code(() => workspace.upload('', '假图.png', Buffer.from('hello'), false)), 'unsupported_type');
  assert.equal(code(() => workspace.upload('', 'run.sh', Buffer.from('echo'), false)), 'unsupported_type');
  assert.equal(code(() => workspace.upload('', 'page.html', Buffer.from('<p>'), false)), 'unsupported_type');
  assert.equal(code(() => workspace.upload('', 'a.txt', Buffer.from([0x61, 0]), false)), 'unsupported_type');
  const big = Buffer.alloc(UPLOAD_MAX_BYTES + 1, 0x61);
  assert.equal(code(() => workspace.upload('', 'big.txt', big, false)), 'too_large');
  assert.equal(code(() => workspace.upload('', '图.png', PNG, false)), 'conflict');
  assert.equal(workspace.upload('', '图.png', PNG, true).bytes, PNG.length);
});

test('改名 / 移动要打一遍现在的名字；挪进回收可以还原，原位置有同名的就不还原', () => {
  workspace.mkdir('docs');
  workspace.upload('', 'plan.md', Buffer.from('计划'), false);
  assert.equal(code(() => workspace.move('plan.md', 'docs/plan.md', 'plan')), 'invalid_input');
  const moved = workspace.move('plan.md', 'docs/plan.md', 'plan.md');
  assert.equal(moved.path, 'docs/plan.md');
  assert.equal(code(() => workspace.trash('docs/plan.md', 'docs')), 'invalid_input');
  const trashed = workspace.trash('docs/plan.md', 'plan.md');
  assert.equal(existsSync(join(dir.directory, 'files', 'docs', 'plan.md')), false);
  assert.deepEqual(workspace.trashed().map((entry) => entry.originalPath), ['docs/plan.md']);
  workspace.upload('docs', 'plan.md', Buffer.from('新的'), false);
  assert.equal(code(() => workspace.restore(trashed.id)), 'conflict');
  workspace.trash('docs/plan.md', 'plan.md');
  assert.equal(workspace.restore(trashed.id).path, 'docs/plan.md');
  assert.equal(readFileSync(join(dir.directory, 'files', 'docs', 'plan.md'), 'utf8'), '计划');
  assert.equal(code(() => workspace.restore('not-an-id')), 'not_found');
  assert.equal(code(() => workspace.trash('', '')), 'invalid_input');
});

test('不能把文件夹移进它自己里面', () => {
  workspace.mkdir('a');
  workspace.mkdir('a/b');
  assert.equal(code(() => workspace.move('a', 'a/b/a', 'a')), 'invalid_input');
});

test('文本保存核对读取版本，冲突不覆盖；新文件和整台服务器路径可写', () => {
  const path = join(dir.directory, 'direct.txt');
  const first = workspace.writeText(path, '第一版', null);
  const second = workspace.writeText(path, '第二版', first.version);
  assert.notEqual(second.version, first.version);
  assert.equal(code(() => workspace.writeText(path, '旧草稿', first.version)), 'conflict');
  assert.equal(readFileSync(path, 'utf8'), '第二版');
  assert.equal(workspace.readText(path).text, '第二版');
});

test('从符号链接编辑文本写入实际目标，保留链接和目标原权限', () => {
  const target = join(dir.directory, 'target.txt');
  writeFileSync(target, '原文', { mode: 0o640 });
  // 创建权限受运行环境 umask 影响；这里验证编辑保留实际原权限，而非假定 umask 为 0022。
  const originalMode = lstatSync(target).mode & 0o777;
  workspace.list('');
  symlinkSync(target, join(dir.directory, 'files', 'link.txt'));
  workspace.writeText('link.txt', '核对后的正文', workspace.readText('link.txt').version);
  assert.ok(lstatSync(join(dir.directory, 'files', 'link.txt')).isSymbolicLink());
  assert.equal(readFileSync(target, 'utf8'), '核对后的正文');
  assert.equal(lstatSync(target).mode & 0o777, originalMode);
});
