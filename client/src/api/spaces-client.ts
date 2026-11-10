// 空间与订阅的接口签名（《优化清单》第 6、7 条；服务端 agent/src/app/spaces.ts、subscriptions.ts）。
// http/spaces.ts 是真实现，fake/fake-spaces.ts 给本机开发和测试用。形状都是 agent/shared/api/spaces.ts 的。

import type {
  AdoptRuleRequest,
  DeleteSpaceRequest,
  RestoreSpaceRequest,
  ReviewSummary,
  RunSubscriptionRequest,
  RunSubscriptionResponse,
  SaveSpaceRequest,
  SpaceListResponse,
  LibraryTrashResponse,
  SpaceView,
  SpaceVersionsResponse,
  SubscriptionListResponse,
  SubscriptionView,
  UndoSpaceRequest,
  UpdateSubscriptionRequest,
} from './shared.ts';

export interface SpaceListFilter {
  standalone?: boolean;
}

/** GET /v2/library/trash：资料库「最近删除」（空间、图书、文件）。 */
export interface LibraryApi {
  batch(input: import('./shared.ts').LibraryBatchRequest): Promise<import('./shared.ts').BatchResponse>;
  emptyTrash(input: import('./shared.ts').EmptyTrashRequest): Promise<import('./shared.ts').BatchResponse>;
  trash(signal?: AbortSignal): Promise<LibraryTrashResponse>;
}

export interface SpacesApi {
  /** GET /v2/spaces：全部没删的（⌘K 用）；standalone 只要不属于订阅的（资料库第二栏「空间」）。 */
  list(signal?: AbortSignal, filter?: SpaceListFilter): Promise<SpaceListResponse>;
  get(id: string, signal?: AbortSignal): Promise<SpaceView>;
  versions(id: string, version?: number, signal?: AbortSignal): Promise<SpaceVersionsResponse>;
  /** PUT /v2/spaces/:id：改名（只给 title）或在页面上改字（给 html），带 version，旧了 409。 */
  save(id: string, input: SaveSpaceRequest): Promise<SpaceView>;
  /** POST /v2/spaces/:id/undo：撤回最近一版。 */
  undo(id: string, input: UndoSpaceRequest): Promise<SpaceView>;
  /** DELETE /v2/spaces/:id：移到「最近删除」，带 version。 */
  remove(id: string, input: DeleteSpaceRequest): Promise<void>;
  /** POST /v2/spaces/:id/restore：从「最近删除」还原。 */
  restore(id: string, input: RestoreSpaceRequest): Promise<SpaceView>;
  /** 网页里的插图（/v2/notes/assets/…）：沙盒里的页面带不了会话，由外面读好再传进去。 */
  asset(path: string, signal?: AbortSignal): Promise<Blob>;
}

export interface SubscriptionsApi {
  /** GET /v2/subscriptions：信息流第二栏「订阅」、顶部最新一期。 */
  list(signal?: AbortSignal): Promise<SubscriptionListResponse>;
  get(id: string, signal?: AbortSignal): Promise<SubscriptionView>;
  /** PUT /v2/subscriptions/:id：改设置、开定时、暂停。 */
  update(id: string, input: UpdateSubscriptionRequest): Promise<SubscriptionView>;
  /** POST /v2/subscriptions/:id/rules：「以后都这样」。 */
  adoptRule(id: string, input: AdoptRuleRequest): Promise<SubscriptionView>;
  /** POST /v2/subscriptions/:id/run：现在出一期。 */
  run(id: string, input: RunSubscriptionRequest): Promise<RunSubscriptionResponse>;
  /** GET /v2/review：首页「回顾」一节。 */
  review(signal?: AbortSignal): Promise<ReviewSummary>;
}
