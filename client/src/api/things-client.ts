// 第 102 条的接口签名：记忆主题（服务端 agent/src/app/memory-topics.ts；2026-11-05 事删了，首页改读线和卡）。
// http/things.ts 是真实现，fake/ 的内存实现给本机开发和测试用。拿不准的对 / 不对是用户确认字段，由本人会话确认，
// 走 signed（signed-targets.ts 的 memory_uncertain），不在这里。
// 第 10、16 条（11-06）：搜记忆（带归档）和「昨晚整理了什么」（服务端 agent/src/app/memory-library.ts）。
// 请求和回答的形状都是 agent/shared/api/ 里的，这里不另写一份。

import type { AddMemoryLineRequest, ApplyCleanupRequest, ApplyCleanupResponse, EditMemoryLineRequest,
  LatestCleanupResponse, MoveMemoryLineRequest, RetireMemoryLineRequest, StartCleanupRequest } from './shared.ts';
import type {
  ChooseDreamChangeRequest,
  MemoryDreamChangeView,
  MemoryDreamView,
  MemorySearchResponse,
  MemoryTopicDoc,
  MemoryTopicListResponse,
  UndoDreamChangeRequest,
} from './shared.ts';

export interface MemoryTopicsApi {
  /** GET /v2/memory/topics：主题目录（按 关于你和做事方式 · 项目 · 人 · 话题 · 技能 分组）+ 拿不准的 + 昨晚整理的摘要。 */
  list(signal?: AbortSignal): Promise<MemoryTopicListResponse>;
  /** GET /v2/memory/topics/:id：一份活文档。 */
  get(id: string, signal?: AbortSignal): Promise<MemoryTopicDoc>;
  /** GET /v2/memory/search：搜记忆；archive 时连归档。 */
  search(q: string, archive: boolean, signal?: AbortSignal): Promise<MemorySearchResponse>;
  /** GET /v2/memory/dreams/latest：最近一次夜里的整理。 */
  dream(signal?: AbortSignal): Promise<MemoryDreamView>;
  /** POST /v2/memory/dreams/changes/:id/undo */
  undoDream(id: string, input: UndoDreamChangeRequest): Promise<MemoryDreamChangeView>;
  /** POST /v2/memory/dreams/changes/:id/choose */
  chooseDream(id: string, input: ChooseDreamChangeRequest): Promise<MemoryDreamChangeView>;
  // ---- 11-11 记忆页能改、删、加、挪，和全量整理（shared/api/memory-manage.ts） ----
  /** POST /v2/memory/docs/:docId/lines */
  addLine(docId: string, input: AddMemoryLineRequest): Promise<void>;
  /** PUT /v2/memory/docs/:docId/lines/:lineId */
  editLine(docId: string, lineId: string, input: EditMemoryLineRequest): Promise<void>;
  /** POST /v2/memory/docs/:docId/lines/:lineId/retire */
  retireLine(docId: string, lineId: string, input: RetireMemoryLineRequest): Promise<void>;
  /** POST /v2/memory/docs/:docId/lines/:lineId/move */
  moveLine(docId: string, lineId: string, input: MoveMemoryLineRequest): Promise<void>;
  /** GET /v2/memory/cleanups/latest */
  cleanup(signal?: AbortSignal): Promise<LatestCleanupResponse>;
  /** POST /v2/memory/cleanups */
  startCleanup(input: StartCleanupRequest): Promise<void>;
  /** POST /v2/memory/cleanups/:id/apply */
  applyCleanup(id: string, input: ApplyCleanupRequest): Promise<ApplyCleanupResponse>;
}

export interface ThingsApi {
  memoryTopics: MemoryTopicsApi;
}
