// 假资料库沿用各类型的读写规则，批量结果与真实接口一样逐项返回。
import { createRequestId } from '../request-id.ts';
import type { LibraryApi } from '../spaces-client.ts';
import type { BatchItem, LibraryBatchRequest, LibraryTrashItem, LibraryTrashResponse } from '../shared.ts';
import type { FakeBooks } from './fake-books.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeSpaces } from './fake-spaces.ts';
import type { FakeFiles } from './fake-workspace.ts';
import { checkTrashCount, FakeBatchReceipts, fakeBatch } from './fake-batch.ts';

export interface FakeLibraryDeps { session: FakeSession; spaces: FakeSpaces; books: FakeBooks; files: FakeFiles }

export function createFakeLibrary(deps: FakeLibraryDeps): LibraryApi {
  const receipts = new FakeBatchReceipts();
  const trash = async (): Promise<LibraryTrashResponse> => {
    deps.session.require();
    const spaces: LibraryTrashItem[] = deps.spaces.deletedRows().map((row) => ({ kind: 'space', id: row.id,
      title: row.title, deletedAt: row.deletedAt, originalPath: null }));
    const books: LibraryTrashItem[] = deps.books.deletedRows().map((row) => ({ kind: 'book', id: row.id,
      title: row.title, deletedAt: row.deletedAt, originalPath: null }));
    const files: LibraryTrashItem[] = (await deps.files.trashed()).entries.map((entry) => ({
      ...deps.files.trashDetails(entry.id), id: entry.id, title: entry.name, deletedAt: entry.trashedAt,
      originalPath: entry.originalPath }));
    return { items: [...spaces, ...books, ...files].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt)) };
  };
  const title = async (item: BatchItem, deleted: boolean): Promise<string> => {
    if (deleted) {
      const found = (await trash()).items.find((row) => row.kind === item.kind && row.id === item.id);
      if (found === undefined) throw new Error('这一项不在最近删除里。');
      return found.title;
    }
    if (item.kind === 'space') return (await deps.spaces.spaces.get(item.id)).title;
    if (item.kind === 'book') return (await deps.books.get(item.id)).title;
    return item.id.split('/').at(-1) ?? item.id;
  };
  const apply = async (item: BatchItem, input: LibraryBatchRequest): Promise<unknown> => {
    const requestId = createRequestId();
    const action = input.action;
    if (item.kind === 'space') {
      if (action === 'restore') return deps.spaces.spaces.restore(item.id, { requestId });
      if (action === 'purge') return deps.spaces.purgeDeleted(item.id);
      const view = await deps.spaces.spaces.get(item.id);
      return action === 'trash' ? deps.spaces.spaces.remove(item.id, { requestId, version: view.version })
        : deps.spaces.spaces.save(item.id, { requestId, version: view.version, folder: input.destination || null });
    }
    if (item.kind === 'book') {
      switch (action) {
        case 'restore': return deps.books.restore(item.id, requestId);
        case 'purge': return deps.books.purgeDeleted(item.id);
        case 'trash': return deps.books.remove(item.id, requestId);
        case 'move': return deps.books.rename(item.id, { requestId, folder: input.destination || null });
      }
    }
    const name = item.id.split('/').at(-1) ?? item.id;
    switch (action) {
      case 'restore': return deps.files.restore({ requestId, id: item.id });
      case 'purge': return deps.files.purgeDeleted(item.id);
      case 'trash': return deps.files.trash({ requestId, path: item.id, confirmName: name });
      case 'move': return deps.files.move({ requestId, from: item.id, confirmName: name,
        to: `${input.destination?.replace(/\/$/, '') || ''}${input.destination ? '/' : ''}${name}` });
    }
  };
  const batch = (input: LibraryBatchRequest) => fakeBatch(input.items,
    (item) => title(item, input.action === 'restore' || input.action === 'purge'), (item) => apply(item, input));
  return {
    trash,
    batch: async (input) => { deps.session.require(); return receipts.run(input, () => batch(input)); },
    emptyTrash: async (input) => {
      deps.session.require();
      return receipts.run(input, async () => {
        const { items } = await trash();
        checkTrashCount(items.length, input.expectCount);
        return batch({ requestId: input.requestId, action: 'purge', items });
      });
    },
  };
}
