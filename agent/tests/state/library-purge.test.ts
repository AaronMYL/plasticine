import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { EMPTY_SPACE_DOC } from '../../shared/state.ts';
import { openDatabase } from '../../src/state/db.ts';
import { prepareOfflineRestore } from '../../src/state/index.ts';
import { openTestState, throwsState } from './helpers.ts';

test('永久删除笔记清除正文和所有修订，只留不可还原的删除记录', async (t) => {
  const fixture = await openTestState();
  t.after(() => fixture.cleanup());
  const { state } = fixture;
  const note = state.notes.create({ markdown: '# 测试文稿\n\n原始正文', folder: '收件', author: 'user' });
  const updated = state.notes.save(note.id, note.version, { markdown: '# 测试文稿\n\n修改后的正文' });
  const files = state.notes.versions(note.id).map((version) => join(state.notes.directory(), version.bodyFile));
  throwsState(() => state.libraryPurge.note(note.id), 'invalid_input');
  state.notes.markDeleted(updated.id);
  state.libraryPurge.note(note.id);
  assert.equal(state.notes.get(note.id), undefined);
  assert.deepEqual(state.notes.list({ deletedOnly: true }), []);
  assert.equal(state.notes.folders.list().deletedCount, 0);
  assert.deepEqual(state.notes.versions(note.id), []);
  assert.ok(files.every((file) => !existsSync(file)));
  throwsState(() => state.notes.restore(note.id), 'not_found');
  state.libraryPurge.note(note.id);
  fixture.close();
  const db = openDatabase(fixture.path);
  try {
    const row = db.get('SELECT * FROM notes WHERE id = $id', { id: note.id });
    assert.ok(row?.['purged_at']);
    assert.equal(row?.['preview'], '');
    assert.equal(row?.['body_file'], '');
    assert.deepEqual(db.all('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});

test('永久删除空间清除正文、修订和索引，保留被其他内容使用的图片', async (t) => {
  const fixture = await openTestState();
  t.after(() => fixture.cleanup());
  const { state } = fixture;
  const shared = state.notes.writeAsset(Buffer.from('shared picture'), 'image/png').name;
  const own = state.notes.writeAsset(Buffer.from('own picture'), 'image/png').name;
  state.notes.create({ markdown: `# 图片笔记\n\n![图片](/v2/notes/assets/${shared})`, folder: '收件', author: 'user' });
  const space = state.spaces.create({ title: '空间测试', doc: EMPTY_SPACE_DOC, genre: 'report', author: 'ai',
    html: `<h1>隐藏星球</h1><img src="/v2/notes/assets/${shared}"><img src="/v2/notes/assets/${own}">` });
  state.spaces.markDeleted(space.id, space.version);
  state.libraryPurge.space(space.id);
  assert.equal(state.spaces.get(space.id), undefined);
  assert.deepEqual(state.spaces.deleted(), []);
  assert.deepEqual(state.spaces.revisions(space.id), []);
  assert.equal(state.spaces.revision(space.id, 1), undefined);
  throwsState(() => state.spaces.restore(space.id), 'not_found');
  assert.ok(existsSync(state.notes.assetPath(shared)));
  assert.equal(existsSync(state.notes.assetPath(own)), false);
  assert.deepEqual(state.search.query({ q: '隐藏星球' }).results, []);
});

test('永久删除图书清除原文件、章节与标注，重新上传不会还原已清空的旧书', async (t) => {
  const fixture = await openTestState();
  t.after(() => fixture.cleanup());
  const { state } = fixture;
  const id = 'purge-book';
  state.bookFiles.write(id, { source: Buffer.from('书的原文'), format: 'txt',
    chapters: [{ title: '第一章', html: '<p>书的原文</p>', text: '书的原文' }], images: [] });
  const book = state.books.create({ title: '测试图书', author: null, language: 'zh', format: 'txt',
    fileName: 'test.txt', sourceBytes: 12, sourceSha256: 'a'.repeat(64), coverAsset: null,
    toc: [{ title: '第一章', chars: 4 }], charCount: 4 }, id);
  state.books.update(id, book.version, { deletedAt: new Date().toISOString() });
  state.libraryPurge.book(id);
  assert.equal(state.books.get(id), undefined);
  assert.deepEqual(state.books.deleted(), []);
  assert.equal(state.books.findDeletedBySource(book.sourceSha256), undefined);
  assert.equal(existsSync(join(dirname(fixture.path), 'books', id)), false);
  assert.throws(() => state.bookFiles.content(id));
  assert.ok(!readFileSync(fixture.path).includes(Buffer.from('书的原文')));
});

test('清空后的离线备份恢复应用当前删除记录，不把旧正文恢复出来', async (t) => {
  const fixture = await openTestState();
  t.after(() => fixture.cleanup());
  const { state } = fixture;
  const note = state.notes.create({ markdown: '# 恢复演练\n\n不再恢复的正文', folder: '收件', author: 'user' });
  const backup = state.backups.begin('before-purge-backup', 'manual');
  state.backups.complete(backup.id);
  state.notes.markDeleted(note.id);
  state.libraryPurge.note(note.id);
  const after = state.backups.begin('after-purge-backup', 'manual');
  state.backups.complete(after.id);
  fixture.close();
  const result = prepareOfflineRestore({ stateDirectory: dirname(fixture.path), backupId: backup.id,
    destination: join(dirname(fixture.path), 'restore-drill') });
  const restored = openDatabase(join(result.restoredDirectory, 'plasticine.sqlite'));
  try {
    const row = restored.get('SELECT * FROM notes WHERE id = $id', { id: note.id });
    assert.ok(row?.['purged_at']);
    assert.equal(row?.['body_file'], '');
    assert.equal(existsSync(join(result.restoredDirectory, 'notes', note.bodyFile)), false);
    assert.deepEqual(restored.all('PRAGMA foreign_key_check'), []);
    assert.equal(restored.get('PRAGMA integrity_check')?.['integrity_check'], 'ok');
  } finally { restored.close(); }
});
