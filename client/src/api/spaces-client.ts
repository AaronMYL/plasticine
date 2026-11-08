// 空间与订阅的接口签名（《优化清单》第 6、7 条；服务端 agent/src/app/spaces.ts、subscriptions.ts）。
// http/spaces.ts 是真实现，fake/fake-spaces.ts 给本机开发和测试用。形状都是 agent/shared/api/spaces.ts 的。

import type {
  AdoptRuleRequest,
  NoteAssistRequest,
  NoteAssistView,
  ReviewSummary,
  RunSubscriptionRequest,
  RunSubscriptionResponse,
  SaveSpaceRequest,
  SpaceListResponse,
  SpaceView,
  SubscriptionListResponse,
  SubscriptionView,
  UndoSpaceRequest,
  UpdateSubscriptionRequest,
} from './shared.ts';

export interface SpacesApi {
  /** GET /v2/spaces：资料库第二栏「空间」。 */
  list(signal?: AbortSignal): Promise<SpaceListResponse>;
  get(id: string, signal?: AbortSignal): Promise<SpaceView>;
  /** PUT /v2/spaces/:id：他直接改，带 version，旧了 409。 */
  save(id: string, input: SaveSpaceRequest): Promise<SpaceView>;
  /** POST /v2/spaces/:id/undo：撤回最近一版。 */
  undo(id: string, input: UndoSpaceRequest): Promise<SpaceView>;
  /** POST /v2/spaces/:id/assist：续写、补充（和笔记同一个助手）。 */
  assist(id: string, input: NoteAssistRequest, signal?: AbortSignal): Promise<NoteAssistView>;
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
