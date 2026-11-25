import type { BookmarksApi } from '../bookmarks-client.ts';
import {
  BOOKMARKS_IMPORT_PATH,
  BOOKMARKS_ORDER_PATH,
  BOOKMARKS_PATH,
  BookmarkListResponseSchema,
  BookmarkResponseSchema,
  BookmarkViewSchema,
  ImportBookmarksResponseSchema,
} from '../shared.ts';
import { conflictWith } from './conflict.ts';
import type { Transport } from './transport.ts';

function bookmarkPath(id: string): string {
  return `${BOOKMARKS_PATH}/${encodeURIComponent(id)}`;
}

export function createBookmarksHttp(transport: Transport): BookmarksApi {
  return {
    list: (signal) => transport.request({ method: 'GET', path: BOOKMARKS_PATH, schema: BookmarkListResponseSchema,
      what: '读书签', lostAs: 'failed', signal }),
    add: async (input) => (await transport.request({ method: 'POST', path: BOOKMARKS_PATH, body: input,
      schema: BookmarkResponseSchema, what: '加书签', lostAs: 'uncertain' })).bookmark,
    edit: async (id, input) => (await transport.request({ method: 'PUT', path: bookmarkPath(id), body: input,
      schema: BookmarkResponseSchema, what: '改书签', lostAs: 'uncertain',
      refine: conflictWith(BookmarkViewSchema) })).bookmark,
    remove: async (id, input) => (await transport.request({ method: 'POST', path: `${bookmarkPath(id)}/remove`,
      body: input, schema: BookmarkResponseSchema, what: '移除书签', lostAs: 'uncertain',
      refine: conflictWith(BookmarkViewSchema) })).bookmark,
    restore: async (id, input) => (await transport.request({ method: 'POST', path: `${bookmarkPath(id)}/restore`,
      body: input, schema: BookmarkResponseSchema, what: '撤销移除书签', lostAs: 'uncertain',
      refine: conflictWith(BookmarkViewSchema) })).bookmark,
    order: (input) => transport.request({ method: 'POST', path: BOOKMARKS_ORDER_PATH, body: input,
      schema: BookmarkListResponseSchema, what: '排书签', lostAs: 'uncertain' }),
    importItems: (input) => transport.request({ method: 'POST', path: BOOKMARKS_IMPORT_PATH, body: input,
      schema: ImportBookmarksResponseSchema, what: '导入书签', lostAs: 'uncertain' }),
  };
}
