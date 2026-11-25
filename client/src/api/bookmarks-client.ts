import type {
  AddBookmarkRequest,
  BookmarkListResponse,
  BookmarkView,
  EditBookmarkRequest,
  ImportBookmarksRequest,
  ImportBookmarksResponse,
  OrderBookmarksRequest,
  RemoveBookmarkRequest,
  RestoreBookmarkRequest,
} from './shared.ts';

export interface BookmarksApi {
  list(signal?: AbortSignal): Promise<BookmarkListResponse>;
  add(input: AddBookmarkRequest): Promise<BookmarkView>;
  edit(id: string, input: EditBookmarkRequest): Promise<BookmarkView>;
  remove(id: string, input: RemoveBookmarkRequest): Promise<BookmarkView>;
  restore(id: string, input: RestoreBookmarkRequest): Promise<BookmarkView>;
  order(input: OrderBookmarksRequest): Promise<BookmarkListResponse>;
  importItems(input: ImportBookmarksRequest): Promise<ImportBookmarksResponse>;
}
