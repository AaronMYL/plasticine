// 假「最近删除」（GET /v2/library/trash，11-08）：把假空间、假图书里删掉的和假文件回收里的合成一张，删的时间新的在前。

import type { LibraryApi } from '../spaces-client.ts';
import type { LibraryTrashItem, LibraryTrashResponse } from '../shared.ts';
import type { FakeBooks } from './fake-books.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeSpaces } from './fake-spaces.ts';
import type { FakeFiles } from './fake-workspace.ts';

export interface FakeLibraryDeps {
  session: FakeSession;
  spaces: FakeSpaces;
  books: FakeBooks;
  files: FakeFiles;
}

export function createFakeLibrary(deps: FakeLibraryDeps): LibraryApi {
  return {
    trash: async (): Promise<LibraryTrashResponse> => {
      deps.session.require();
      const spaces: LibraryTrashItem[] = deps.spaces.deletedRows().map((row) => ({ kind: 'space', id: row.id,
        title: row.title, deletedAt: row.deletedAt, originalPath: null }));
      const books: LibraryTrashItem[] = deps.books.deletedRows().map((row) => ({ kind: 'book', id: row.id,
        title: row.title, deletedAt: row.deletedAt, originalPath: null }));
      const files: LibraryTrashItem[] = (await deps.files.trashed()).entries.map((entry) => ({ kind: 'file',
        id: entry.id, title: entry.name, deletedAt: entry.trashedAt, originalPath: entry.originalPath }));
      const items = [...spaces, ...books, ...files].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return { items };
    },
  };
}
