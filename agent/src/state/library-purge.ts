import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { BookFiles } from './book-files.ts';
import { StateError, notFound } from './errors.ts';
import type { NoteBodies } from './note-bodies.ts';
import type { StoreContext } from './object-store.ts';
import { noteAssetRefs } from './note-asset-refs.ts';
import { spaceAssetRefs } from './library-assets.ts';
import { legacyNoteHistory } from './note-import-details.ts';

type Table = 'notes' | 'spaces' | 'books';

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

  function noteAssets(files: readonly string[]): Set<string> {
    return new Set(files.flatMap((file) => {
      const path = bodyPath(file);
      return existsSync(path) ? [...noteAssetRefs(readFileSync(path, 'utf8'))] : [];
    }));
  }

  function legacyAssets(id?: string, exclude?: string): Set<string> {
    const where = id === undefined ? 'purged_at IS NULL AND id != $exclude' : 'id = $id';
    const params = id === undefined ? { exclude: exclude ?? '' } : { id };
    const rows = db.all(`SELECT legacy_payload FROM notes WHERE ${where} AND legacy_payload IS NOT NULL`, params);
    return new Set(rows.flatMap((row) => legacyNoteHistory(JSON.parse(String(row['legacy_payload'])))
      .flatMap((markdown) => [...noteAssetRefs(markdown)])));
  }

  function spaceAssets(id?: string, exclude?: string): Set<string> {
    const where = id === undefined ? 'purged_at IS NULL AND id != $exclude' : 'id = $id';
    const params = id === undefined ? { exclude: exclude ?? '' } : { id };
    const rows = [
      ...db.all(`SELECT doc, html FROM spaces WHERE ${where}`, params),
      ...db.all(`SELECT doc, html FROM space_revisions
        WHERE space_id IN (SELECT id FROM spaces WHERE ${where})`, params),
    ];
    return new Set(rows.flatMap((row) => [...spaceAssetRefs(String(row['doc']), String(row['html'] ?? ''))]));
  }

  function pruneAssets(candidates: ReadonlySet<string>, table: Table, id: string): void {
    if (candidates.size === 0) { return; }
    const otherNotes = noteFiles(undefined, table === 'notes' ? id : undefined);
    const otherSpaces = spaceAssets(undefined, table === 'spaces' ? id : undefined);
    const used = new Set([...noteAssets(otherNotes), ...otherSpaces,
      ...legacyAssets(undefined, table === 'notes' ? id : undefined)]);
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
      const assets = new Set([...noteAssets(files), ...legacyAssets(id)]);
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
      const assets = spaceAssets(id);
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
