import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Database } from './db.ts';
import { BookFiles } from './book-files.ts';
import { createLibraryPurge } from './library-purge.ts';
import { migrate, MIGRATIONS } from './migrations/index.ts';
import { NoteBodies } from './note-bodies.ts';
import { createSearchIndex } from './search-index.ts';

/** 旧快照是保留期内的备份；恢复副本必须重放当前永久删除，不能借恢复复活正文。 */
export function replayLibraryPurges(db: Database, current: Database, directory: string, at: string): void {
  const notes = new NoteBodies(join(directory, 'notes'));
  migrate(db, MIGRATIONS, () => at, {
    writeNoteBody(id, markdown) {
      const file = notes.fileFor(id);
      const digest = notes.write(file, markdown);
      return { file, bytes: digest.bytes, sha256: digest.sha256 };
    },
  });
  const index = createSearchIndex(db, notes);
  const purge = createLibraryPurge({ db, now: () => at, newId: randomUUID, index }, notes,
    new BookFiles(join(directory, 'books')));
  for (const [table, kind] of [['notes', 'note'], ['spaces', 'space'], ['books', 'book']] as const) {
    if (!current.all(`PRAGMA table_info(${table})`).some((row) => row['name'] === 'purged_at')) { continue; }
    for (const row of current.all(`SELECT id, deleted_at, purged_at FROM ${table} WHERE purged_at IS NOT NULL`)) {
      const id = String(row['id']);
      if (db.get(`SELECT id FROM ${table} WHERE id = $id`, { id }) === undefined) { continue; }
      db.run(`UPDATE ${table} SET deleted_at = $deleted WHERE id = $id`,
        { id, deleted: String(row['deleted_at'] ?? row['purged_at']) });
      purge[kind](id);
      db.run(`UPDATE ${table} SET purged_at = $at WHERE id = $id`, { id, at: String(row['purged_at']) });
    }
  }
}
