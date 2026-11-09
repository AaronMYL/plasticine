// 书签的接口签名（第 110 条，服务端 agent/src/app/bookmarks.ts）：http/bookmarks.ts 是真实现，fake/fake-bookmarks.ts
// 给本机开发和测试用。信息流的收藏走 feed.save，和书签分开（2026-11-04）。形状都在 agent/shared/api。

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
  /** GET /v2/bookmarks：在用的书签，按排好的先后；没归项目的带 Plasticine 推的项目。 */
  list(signal?: AbortSignal): Promise<BookmarkListResponse>;
  /** POST /v2/bookmarks：同一个网址 / 地址已经有了就回那一条。 */
  add(input: AddBookmarkRequest): Promise<BookmarkView>;
  /** PUT /v2/bookmarks/:id：改名、移项目；过时了是 ConflictError（带现在那一条）。 */
  edit(id: string, input: EditBookmarkRequest): Promise<BookmarkView>;
  /** POST /v2/bookmarks/:id/remove。 */
  remove(id: string, input: RemoveBookmarkRequest): Promise<BookmarkView>;
  /** POST /v2/bookmarks/:id/restore：撤销移除；同一个网址这期间又加了一条就回那一条。 */
  restore(id: string, input: RestoreBookmarkRequest): Promise<BookmarkView>;
  /** POST /v2/bookmarks/order。 */
  order(input: OrderBookmarksRequest): Promise<BookmarkListResponse>;
  /** POST /v2/bookmarks/import：浏览器导出的书签，文件夹已经对到项目上、用户确认过。 */
  importItems(input: ImportBookmarksRequest): Promise<ImportBookmarksResponse>;
}
