import type { NotesApi } from '../../api/client.ts';
import type { LibraryApi } from '../../api/spaces-client.ts';
import type { BulkCommand } from './use-bulk-selection.ts';

export const libraryBatch = (api: LibraryApi, input: BulkCommand) => api.batch({ ...input,
  items: input.items.map((item) => {
    if (item.kind === 'note') throw new Error('笔记需要从笔记列表操作。');
    return { kind: item.kind, id: item.id };
  }),
});
export const notesBatch = (api: NotesApi, input: BulkCommand) => api.batch({ ...input,
  items: input.items.map((item) => {
    if (item.kind !== 'note') throw new Error('这里仅能操作笔记。');
    return { kind: 'note', id: item.id };
  }),
});
