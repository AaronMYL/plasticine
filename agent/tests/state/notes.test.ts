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

test('Creating note writes file under notes/ and records byte size and SHA-256', () => {
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

test('Title strips markdown from first non-empty line; excerpt replaces media/charts', () => {
  assert.equal(titleOf('\n\n## **重要** 的事\n第二行'), '重要 的事');
  assert.equal(titleOf('   \n'), '新笔记');
  assert.equal(previewOf('标题\n看 ![图](/v1/notes/assets/a.png) 和\n```chart\n{}\n```'), '看 ［图片］ 和 ［图表］');
  assert.equal(previewOf('# 标题\n\n- [ ] 待办一\n- [x] 待办二\n\n看 [这篇](https://example.com/a) 再说'),
    '待办一 待办二 看 这篇 再说');
});

test('Save checks version: matching writes and bumps; mismatch conflicts without edit', () => {
  const note = t.state.notes.create(input());
  const saved = t.state.notes.save(note.id, 1, { markdown: '# 周末计划\n改成去灵隐寺' });
  assert.equal(saved.version, 2);
  assert.equal(t.state.notes.readBody(saved), '# 周末计划\n改成去灵隐寺');
  const conflict = throwsState(() => t.state.notes.save(note.id, 1, { markdown: '旧版本上的改动' }), 'version_conflict');
  assert.equal(conflict.currentVersion, 2);
  assert.equal(t.state.notes.readBody(saved), '# 周末计划\n改成去灵隐寺');
});

test('Each save writes a new revision file; older revisions remain readable by version', () => {
  const note = t.state.notes.create(input());
  const saved = t.state.notes.save(note.id, 1, { markdown: '# 周末计划\n改成去灵隐寺' });
  assert.notEqual(saved.bodyFile, note.bodyFile);
  assert.equal(readFileSync(join(notesDir(), note.bodyFile), 'utf8'), input().markdown);
  assert.deepEqual(t.state.notes.versions(note.id).map((row) => row.version), [2, 1]);
  assert.equal(t.state.notes.readVersion(note.id, 1)?.markdown, input().markdown);
  assert.equal(t.state.notes.readVersion(note.id, 2)?.markdown, '# 周末计划\n改成去灵隐寺');
  assert.equal(t.state.notes.readVersion(note.id, 3), undefined);
});

test('Conflicting save leaves no orphan file and keeps row pointing to prior version', () => {
  const note = t.state.notes.create(input());
  t.state.notes.save(note.id, 1, { markdown: '第二版' });
  throwsState(() => t.state.notes.save(note.id, 1, { markdown: '基于旧版的改动' }), 'version_conflict');
  const current = t.state.notes.require(note.id);
  assert.equal(current.version, 2);
  assert.equal(t.state.notes.readBody(current), '第二版');
  assert.equal(t.state.notes.versions(note.id).length, 2);
});

test('Saving unchanged content does not increment version', () => {
  const note = t.state.notes.create(input());
  assert.equal(t.state.notes.save(note.id, 1, { markdown: input().markdown, pinned: false }).version, 1);
});

test('Outer txn rollback after note save keeps old body intact so retry succeeds', () => {
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

test('Deleting note timestamps only, keeps file, hides from list, blocks further edits', () => {
  const note = t.state.notes.create(input());
  const deleted = t.state.notes.markDeleted(note.id);
  assert.notEqual(deleted.deletedAt, null);
  assert.equal(readFileSync(join(notesDir(), note.bodyFile), 'utf8'), input().markdown);
  assert.deepEqual(t.state.notes.list(), []);
  assert.equal(t.state.notes.list({ includeDeleted: true }).length, 1);
  throwsState(() => t.state.notes.save(note.id, deleted.version, { markdown: 'x' }), 'invalid_input');
  assert.equal(t.state.notes.markDeleted(note.id).deletedAt, deleted.deletedAt);
});

test('Read-only original note cannot have its body modified', () => {
  const note = t.state.notes.create(input({ readOnly: true }));
  throwsState(() => t.state.notes.save(note.id, 1, { markdown: '改' }), 'invalid_input');
  assert.equal(t.state.notes.save(note.id, 1, { pinned: true }).pinned, true);
});

test('Note list places pinned first, then orders by updated_at newest to oldest', () => {
  const old = t.state.notes.create(input({ markdown: '旧的' }));
  const pinned = t.state.notes.create(input({ markdown: '置顶', pinned: true }));
  const fresh = t.state.notes.create(input({ markdown: '新的' }));
  assert.deepEqual(
    t.state.notes.list().map((note) => note.id),
    [pinned.id, fresh.id, old.id],
  );
});

test('Migrated notes preserve original created_at and updated_at timestamps', () => {
  const createdAt = new Date(START - 86_400_000).toISOString();
  const note = t.state.notes.create(input(), { createdAt, updatedAt: createdAt, legacyPayload: { id: 'n-old' } });
  assert.equal(note.createdAt, createdAt);
  assert.deepEqual(note.legacyPayload, { id: 'n-old' });
});

test('Reads images by name from notes/assets and rejects names with path segments', () => {
  mkdirSync(join(notesDir(), 'assets'), { recursive: true });
  writeFileSync(join(notesDir(), 'assets', '0123456789abcdef.png'), Buffer.from([1, 2, 3]));
  const asset = t.state.notes.readAsset('0123456789abcdef.png');
  assert.equal(asset?.type, 'image/png');
  assert.deepEqual([...(asset?.data ?? [])], [1, 2, 3]);
  assert.equal(t.state.notes.readAsset('missing0000000000.png'), undefined);
  throwsState(() => t.state.notes.readAsset('../plasticine.sqlite'), 'invalid_input');
  throwsState(() => t.state.notes.readAsset('..png'), 'invalid_input');
});

test('In-memory DB without configured notes directory cannot save notes', () => {
  const state = openState({ path: ':memory:' });
  try {
    throwsState(() => state.notes.create(input()), 'invalid_input');
  } finally {
    state.close();
  }
});
