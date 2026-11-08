import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { NoteInput } from '../../shared/state.ts';
import { openState, previewOf, titleOf } from '../../src/state/index.ts';
import { openTestState, START, throwsState, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function input(overrides: Partial<NoteInput> = {}): NoteInput {
  return { markdown: '# 周末计划\n去西湖，带相机\n- [ ] 订票', folder: '笔记', author: 'user', ...overrides };
}

const notesDir = (): string => join(dirname(t.path), 'notes');

test('私密图片只按真实本站图片引用精确归属，正文提及、前缀相似与站外图不误伤', () => {
  const note = t.state.notes.create(input({ private: true, markdown: [
    '普通文字 public.png 以及 /v2/notes/assets/public.png',
    '![较长资源](/v2/notes/assets/prefix-public.png)',
    '![站外](https://elsewhere.test/v2/notes/assets/public.png)',
    '`![代码](/v2/notes/assets/public.png)`',
    '```md\n![代码块](/v2/notes/assets/public.png)\n```',
    '![本站](/v2/notes/assets/private%2Epng?version=1#图)',
    '<img src="/v2/notes/assets/html.png">',
    '![引用图][picture]\n\n[picture]: /v1/notes/assets/legacy.png "旧图"',
    '![绝对本站](https://plasticine.test/v2/notes/assets/absolute.png)',
  ].join('\n\n') }));
  assert.deepEqual(t.state.notes.privateAssetNotes('public.png', 'https://plasticine.test'), []);
  for (const name of ['prefix-public.png', 'private.png', 'html.png', 'legacy.png', 'absolute.png']) {
    assert.deepEqual(t.state.notes.privateAssetNotes(name, 'https://plasticine.test'), [note.id]);
  }
  t.state.notes.save(note.id, note.version, { markdown: '图片已从当前正文移走' });
  assert.deepEqual(t.state.notes.privateAssetNotes('private.png'), [note.id]);
  assert.deepEqual(t.state.notes.privateAssetNotes('legacy.png'), [note.id]);
});

test('新建一篇：正文写成 notes/ 下的文件，行里记着字节数和 SHA-256', () => {
  const note = t.state.notes.create(input());
  const file = readFileSync(join(notesDir(), note.bodyFile));
  const markdown = input().markdown;
  assert.equal(file.toString('utf8'), markdown);
  assert.equal(note.bodyBytes, Buffer.byteLength(markdown, 'utf8'));
  assert.equal(note.bodySha256, createHash('sha256').update(markdown).digest('hex'));
  assert.equal(note.title, '周末计划');
  assert.equal(note.version, 1);
  assert.equal(t.state.notes.readBody(note), markdown);
});

test('标题和摘要照旧版算：首个非空行去掉标记、摘要把图片和图表换成占位', () => {
  assert.equal(titleOf('\n\n## **重要** 的事\n第二行'), '重要 的事');
  assert.equal(titleOf('   \n'), '新笔记');
  assert.equal(previewOf('标题\n看 ![图](/v1/notes/assets/a.png) 和\n```chart\n{}\n```'), '看 ［图片］ 和 ［图表］');
});

test('保存带版本：对得上就写新正文、版本加一；对不上就报版本冲突，正文不动', () => {
  const note = t.state.notes.create(input());
  const saved = t.state.notes.save(note.id, 1, { markdown: '# 周末计划\n改成去灵隐寺' });
  assert.equal(saved.version, 2);
  assert.equal(t.state.notes.readBody(saved), '# 周末计划\n改成去灵隐寺');
  const conflict = throwsState(() => t.state.notes.save(note.id, 1, { markdown: '旧版本上的改动' }), 'version_conflict');
  assert.equal(conflict.currentVersion, 2);
  assert.equal(t.state.notes.readBody(saved), '# 周末计划\n改成去灵隐寺');
});

test('每次保存写一个新的正文版本文件；旧版本的文件和字还在，可以按版本读回来', () => {
  const note = t.state.notes.create(input());
  const saved = t.state.notes.save(note.id, 1, { markdown: '# 周末计划\n改成去灵隐寺' });
  assert.notEqual(saved.bodyFile, note.bodyFile);
  assert.equal(readFileSync(join(notesDir(), note.bodyFile), 'utf8'), input().markdown);
  assert.deepEqual(t.state.notes.versions(note.id).map((row) => row.version), [2, 1]);
  assert.equal(t.state.notes.readVersion(note.id, 1)?.markdown, input().markdown);
  assert.equal(t.state.notes.readVersion(note.id, 2)?.markdown, '# 周末计划\n改成去灵隐寺');
  assert.equal(t.state.notes.readVersion(note.id, 3), undefined);
});

test('版本冲突的保存不留下新文件，行还指着原来那一版（review-followups e4cef52）', () => {
  const note = t.state.notes.create(input());
  t.state.notes.save(note.id, 1, { markdown: '第二版' });
  throwsState(() => t.state.notes.save(note.id, 1, { markdown: '基于旧版的改动' }), 'version_conflict');
  const current = t.state.notes.require(note.id);
  assert.equal(current.version, 2);
  assert.equal(t.state.notes.readBody(current), '第二版');
  assert.equal(t.state.notes.versions(note.id).length, 2);
});

test('内容没变的保存不加版本', () => {
  const note = t.state.notes.create(input());
  assert.equal(t.state.notes.save(note.id, 1, { markdown: input().markdown, pinned: false }).version, 1);
});

test('笔记保存后外层事务失败，旧版正文不变，再次保存仍可成功', () => {
  const note = t.state.notes.create(input());
  assert.throws(() => t.state.transaction(() => {
    t.state.notes.save(note.id, 1, { markdown: '将要回滚的正文' });
    throw new Error('事务失败');
  }), /事务失败/);
  assert.equal(t.state.notes.require(note.id).version, 1);
  assert.equal(t.state.notes.readBody(note), input().markdown);
  assert.equal(t.state.notes.readVersion(note.id, 2), undefined);
  const saved = t.state.notes.save(note.id, 1, { markdown: '重新保存的正文' });
  assert.equal(saved.version, 2);
  assert.equal(t.state.notes.readVersion(note.id, 2)?.markdown, '重新保存的正文');
});

test('删除只打删除时间：行和文件都还在，列表里不再出现；删了的不能再改', () => {
  const note = t.state.notes.create(input());
  const deleted = t.state.notes.markDeleted(note.id);
  assert.notEqual(deleted.deletedAt, null);
  assert.equal(readFileSync(join(notesDir(), note.bodyFile), 'utf8'), input().markdown);
  assert.deepEqual(t.state.notes.list(), []);
  assert.equal(t.state.notes.list({ includeDeleted: true }).length, 1);
  throwsState(() => t.state.notes.save(note.id, deleted.version, { markdown: 'x' }), 'invalid_input');
  assert.equal(t.state.notes.markDeleted(note.id).deletedAt, deleted.deletedAt);
});

test('只读的原版不能改正文', () => {
  const note = t.state.notes.create(input({ readOnly: true }));
  throwsState(() => t.state.notes.save(note.id, 1, { markdown: '改' }), 'invalid_input');
  assert.equal(t.state.notes.save(note.id, 1, { pinned: true }).pinned, true);
});

test('列表置顶的在前，其余按更新时间新到旧', () => {
  const old = t.state.notes.create(input({ markdown: '旧的' }));
  const pinned = t.state.notes.create(input({ markdown: '置顶', pinned: true }));
  const fresh = t.state.notes.create(input({ markdown: '新的' }));
  assert.deepEqual(
    t.state.notes.list().map((note) => note.id),
    [pinned.id, fresh.id, old.id],
  );
});

test('迁移来的笔记保留原来的创建和更新时间', () => {
  const createdAt = new Date(START - 86_400_000).toISOString();
  const note = t.state.notes.create(input(), { createdAt, updatedAt: createdAt, legacyPayload: { id: 'n-old' } });
  assert.equal(note.createdAt, createdAt);
  assert.deepEqual(note.legacyPayload, { id: 'n-old' });
});

test('图片按名字从 notes/assets 读；名字里带路径的拒绝', () => {
  mkdirSync(join(notesDir(), 'assets'), { recursive: true });
  writeFileSync(join(notesDir(), 'assets', '0123456789abcdef.png'), Buffer.from([1, 2, 3]));
  const asset = t.state.notes.readAsset('0123456789abcdef.png');
  assert.equal(asset?.type, 'image/png');
  assert.deepEqual([...(asset?.data ?? [])], [1, 2, 3]);
  assert.equal(t.state.notes.readAsset('missing0000000000.png'), undefined);
  throwsState(() => t.state.notes.readAsset('../plasticine.sqlite'), 'invalid_input');
  throwsState(() => t.state.notes.readAsset('..png'), 'invalid_input');
});

test('内存库没配笔记目录时存不了笔记', () => {
  const state = openState({ path: ':memory:' });
  try {
    throwsState(() => state.notes.create(input()), 'invalid_input');
  } finally {
    state.close();
  }
});
