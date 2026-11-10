import { DEFAULT_NOTE_FOLDER, NoteFolderSchema, type NoteRecord } from '../../shared/state.ts';
import type { NoteFoldersView } from '../../shared/api/notes-workspace.ts';
import { checked } from './codec.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';

export const MERGED_NOTE_FOLDER = '已合并（原版）';

export function createNoteFolders(
  context: StoreContext,
  moveNotes: (from: string, to: string) => void,
) {
  const db = context.db;
  function nameOf(name: string): string {
    return checked(NoteFolderSchema, name.trim(), 'invalid_input', '文件夹名称');
  }
  function custom(name: string): void {
    if (name === DEFAULT_NOTE_FOLDER || name === MERGED_NOTE_FOLDER) {
      throw new StateError('invalid_input', '这个固定文件夹不能重命名或移除。');
    }
  }
  function sync(): void {
    db.run('INSERT OR IGNORE INTO note_folders (name, position) VALUES ($name, 0)', { name: DEFAULT_NOTE_FOLDER });
    const rows = db.all(`SELECT DISTINCT folder FROM notes
      WHERE moved_to_space_id IS NULL AND purged_at IS NULL ORDER BY created_at, id`);
    for (const row of rows) {
      const name = String(row['folder']);
      if (name !== MERGED_NOTE_FOLDER) {
        db.run(`INSERT OR IGNORE INTO note_folders (name, position)
          VALUES ($name, (SELECT COALESCE(MAX(position), 0) + 1 FROM note_folders))`, { name });
      }
    }
  }
  function names(): string[] {
    sync();
    // 迁走的文件夹（0084「Plasticine 写的」）标了 retired_at，不再列出。
    return db.all('SELECT name FROM note_folders WHERE retired_at IS NULL ORDER BY position, name')
      .map((row) => String(row['name']));
  }
  function list(): NoteFoldersView {
    const ordered = names();
    const counts = new Map(db.all(`SELECT folder, COUNT(*) AS count FROM notes
      WHERE deleted_at IS NULL AND moved_to_space_id IS NULL AND purged_at IS NULL GROUP BY folder`)
      .map((row) => [String(row['folder']), Number(row['count'])]));
    const deleted = db.get(`SELECT COUNT(*) AS count FROM notes
      WHERE deleted_at IS NOT NULL AND moved_to_space_id IS NULL AND purged_at IS NULL`);
    return {
      folders: ordered.map((name) => ({ name, count: counts.get(name) ?? 0, fixed: name === DEFAULT_NOTE_FOLDER })),
      allCount: [...counts.values()].reduce((sum, value) => sum + value, 0),
      deletedCount: Number(deleted?.['count'] ?? 0),
      mergedCount: counts.get(MERGED_NOTE_FOLDER) ?? 0,
    };
  }
  function create(name: string): NoteFoldersView {
    const value = nameOf(name);
    const existing = names();
    if (existing.includes(value) || value === MERGED_NOTE_FOLDER) {
      throw new StateError('duplicate', '已有同名文件夹，换个名字。');
    }
    // 同名的旧文件夹迁走过（retired_at）：重新启用那一行，不另插。
    const revived = db.run('UPDATE note_folders SET retired_at = NULL, position = $position WHERE name = $name', {
      name: value, position: existing.length,
    });
    if (revived === 0) {
      db.run('INSERT INTO note_folders (name, position) VALUES ($name, $position)', {
        name: value, position: existing.length,
      });
    }
    return list();
  }
  function rename(name: string, next: string): NoteFoldersView {
    custom(name);
    const value = nameOf(next);
    if (name === value) { return list(); }
    const existing = names();
    if (!existing.includes(name)) { throw new StateError('not_found', '文件夹不存在。'); }
    if (existing.includes(value) || value === MERGED_NOTE_FOLDER) {
      throw new StateError('duplicate', '已有同名文件夹，换个名字。');
    }
    return db.transaction(() => {
      db.run('UPDATE note_folders SET name = $next WHERE name = $name', { name, next: value });
      moveNotes(name, value);
      return list();
    });
  }
  function move(name: string, direction: -1 | 1): NoteFoldersView {
    custom(name);
    const ordered = names();
    const index = ordered.indexOf(name);
    const next = index + direction;
    if (index < 0) { throw new StateError('not_found', '文件夹不存在。'); }
    if (next < 1 || next >= ordered.length) { return list(); }
    [ordered[index], ordered[next]] = [ordered[next]!, ordered[index]!];
    return db.transaction(() => {
      ordered.forEach((folder, position) => {
        db.run('UPDATE note_folders SET position = $position WHERE name = $name', { name: folder, position });
      });
      return list();
    });
  }
  function remove(name: string, destination: string): NoteFoldersView {
    custom(name);
    const existing = names();
    if (name === destination || !existing.includes(destination)) {
      throw new StateError('invalid_input', '先选另一个存在的文件夹作为笔记去向。');
    }
    return db.transaction(() => {
      moveNotes(name, destination);
      db.run('DELETE FROM note_folders WHERE name = $name', { name });
      return list();
    });
  }
  return { list, create, rename, move, remove };
}

export type NoteReadable = (note: NoteRecord) => boolean;
