// GET /v2/library/trash（shared/api/library.ts，11-08）：资料库「最近删除」——删掉的空间、图书和文件回收里的，
// 合成一张按删除时间新的在前的表。只读；还原各走各的接口。

import type { LibraryTrashItem, LibraryTrashResponse } from '../../shared/api/index.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';

export function listLibraryTrash(context: RequestContext): Reply {
  requireAuth(context);
  const { state, m5b } = context.deps;
  const spaces: LibraryTrashItem[] = state.spaces.deleted().map((space) => ({ kind: 'space', id: space.id,
    title: space.title, deletedAt: space.deletedAt ?? space.updatedAt, originalPath: null }));
  const books: LibraryTrashItem[] = state.books.deleted().map((book) => ({ kind: 'book', id: book.id,
    title: book.title, deletedAt: book.deletedAt ?? book.updatedAt, originalPath: null }));
  const files: LibraryTrashItem[] = m5b.artifacts.workspace.trashed().map((entry) => ({ kind: 'file', id: entry.id,
    title: entry.name, deletedAt: entry.trashedAt,
    originalPath: entry.originalPath }));
  const items = [...spaces, ...books, ...files].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const body: LibraryTrashResponse = { items };
  return { status: 200, body };
}
