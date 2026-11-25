import type { LibraryTrashItem, LibraryTrashResponse } from '../../shared/api/index.ts';
import { requireAuth, type Reply, type RequestContext } from './context.ts';

export function listLibraryTrash(context: RequestContext): Reply {
  requireAuth(context);
  const { state, toolGroups } = context.deps;
  const spaces: LibraryTrashItem[] = state.spaces.deleted().map((space) => ({ kind: 'space', id: space.id,
    title: space.title, deletedAt: space.deletedAt ?? space.updatedAt, originalPath: null }));
  const books: LibraryTrashItem[] = state.books.deleted().map((book) => ({ kind: 'book', id: book.id,
    title: book.title, deletedAt: book.deletedAt ?? book.updatedAt, originalPath: null }));
  const files: LibraryTrashItem[] = toolGroups.artifacts.workspace.trashed().map((entry) => ({
    ...toolGroups.artifacts.workspace.trashDetails(entry.id), id: entry.id, title: entry.name,
    deletedAt: entry.trashedAt, originalPath: entry.originalPath }));
  const items = [...spaces, ...books, ...files].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const body: LibraryTrashResponse = { items };
  return { status: 200, body };
}
