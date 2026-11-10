import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BookFiles } from './book-files.ts';
import { StateError, notFound } from './errors.ts';
import { ASSET_NAME_PATTERN, type NoteBodies } from './note-bodies.ts';
import type { StoreContext } from './object-store.ts';

type Table = 'notes' | 'spaces' | 'books';

function assetNames(text: string): Set<string> {
  const result = new Set<string>();
  for (const match of text.matchAll(/(?:\/v[12]\/notes\/assets\/|assets\/)([A-Za-z0-9_.-]+)/g)) {
    const name = match[1] ?? '';
    if (ASSET_NAME_PATTERN.test(name)) { result.add(name); }
  }
  return result;
}

/** 真正抹除集中在状态服务里；删除失败保留回收记录，让同一操作可以重试。 */
export function createLibraryPurge(context: StoreContext, notes: NoteBodies, books: BookFiles,
  spaceChanged: (id: string) => void = () => undefined) {
  const { db } = context;
  function pending(table: Table, id: string): boolean {
    const row = db.get(`SELECT deleted_at, purged_at FROM ${table} WHERE id = $id`, { id });
    if (row === undefined) { throw notFound(table, id); }
    if (row['purged_at'] !== null) { return false; }
    if (row['deleted_at'] === null) {
      throw new StateError('invalid_input', '这一项还没移到最近删除，不能永久删除。');
    }
    return true;
  }

  function noteFiles(id?: string, exclude?: string): string[] {
    const where = id === undefined ? 'purged_at IS NULL AND id != $exclude' : 'id = $id';
    const params = id === undefined ? { exclude: exclude ?? '' } : { id };
    return [...new Set([
      ...db.all(`SELECT body_file FROM notes WHERE ${where}`, params),
      ...db.all(`SELECT body_file FROM note_versions WHERE note_id IN (SELECT id FROM notes WHERE ${where})`, params),
    ].map((row) => String(row['body_file'])).filter((file) => file !== ''))];
  }

  function bodyPath(file: string): string {
    if (basename(file) !== file || file === '.' || file === '..') {
      throw new StateError('corrupt_record', '笔记正文路径不合规，没有永久删除。');
    }
    return join(notes.directory, file);
  }

  function contentOf(files: readonly string[]): string {
    return files.map((file) => {
      const path = bodyPath(file);
      return existsSync(path) ? readFileSync(path, 'utf8') : '';
    }).join('\n');
  }

  function spaceContent(id?: string, exclude?: string): string {
    const where = id === undefined ? 'purged_at IS NULL AND id != $exclude' : 'id = $id';
    const params = id === undefined ? { exclude: exclude ?? '' } : { id };
    return [
      ...db.all(`SELECT doc, html FROM spaces WHERE ${where}`, params),
      ...db.all(`SELECT doc, html FROM space_revisions
        WHERE space_id IN (SELECT id FROM spaces WHERE ${where})`, params),
    ].map((row) => `${String(row['doc'] ?? '')}\n${String(row['html'] ?? '')}`).join('\n');
  }

  function pruneAssets(candidates: ReadonlySet<string>, table: Table, id: string): void {
    if (candidates.size === 0) { return; }
    const otherNotes = noteFiles(undefined, table === 'notes' ? id : undefined);
    const otherSpaces = spaceContent(undefined, table === 'spaces' ? id : undefined);
    const used = assetNames(`${contentOf(otherNotes)}\n${otherSpaces}`);
    for (const name of candidates) {
      if (!used.has(name)) { rmSync(notes.assetPath(name), { force: true }); }
    }
  }

  function finish(table: Table, id: string, erase: () => void): void {
    db.erasing(() => {
      erase();
      const at = context.now();
      db.run(`UPDATE ${table} SET purged_at = $at, updated_at = $at, version = version + 1 WHERE id = $id`, { id, at });
      context.index?.changed(table === 'notes' ? 'note' : table === 'spaces' ? 'space' : 'book', id);
      context.index?.purge();
    });
  }

  return {
    note(id: string): void {
      if (!pending('notes', id)) { return; }
      const files = noteFiles(id);
      const assets = assetNames(contentOf(files));
      pruneAssets(assets, 'notes', id);
      for (const file of files) { rmSync(bodyPath(file), { force: true }); }
      finish('notes', id, () => {
        db.run('DELETE FROM note_versions WHERE note_id = $id', { id });
        db.run(`UPDATE notes SET title = '', preview = '', body_file = '', body_bytes = 0,
          body_sha256 = '', legacy_payload = NULL, folder = '', private = 0 WHERE id = $id`, { id });
      });
    },
    space(id: string): void {
      if (!pending('spaces', id)) { return; }
      const assets = assetNames(spaceContent(id));
      pruneAssets(assets, 'spaces', id);
      finish('spaces', id, () => {
        db.run('DELETE FROM space_revisions WHERE space_id = $id', { id });
        db.run('DELETE FROM space_rewrites WHERE space_id = $id', { id });
        db.run(`UPDATE spaces SET title = '已永久删除', html = NULL, doc = '{"stats":[],"blocks":[],"sources":[]}',
          folder = NULL
          WHERE id = $id`, { id });
      });
      spaceChanged(id);
    },
    book(id: string): void {
      if (!pending('books', id)) { return; }
      books.purge(id);
      finish('books', id, () => {
        for (const row of db.all('SELECT id FROM book_annotations WHERE book_id = $id', { id })) {
          db.run('DELETE FROM book_annotations WHERE id = $ref', { ref: String(row['id']) });
          context.index?.changed('book_annotation', String(row['id']));
        }
        db.run('DELETE FROM book_progress WHERE book_id = $id', { id });
        db.run('DELETE FROM book_insights WHERE book_id = $id', { id });
        db.run(`UPDATE books SET title = '', author = NULL, language = NULL, file_name = '', source_sha256 = '',
          cover_asset = NULL, toc = '[]', char_count = 0, legacy_payload = NULL, folder = NULL WHERE id = $id`, { id });
      });
    },
  };
}
