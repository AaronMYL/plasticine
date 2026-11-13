import type { CreateSkillRequest, DraftSkillRequest, InstallSkillRequest, RemoveSkillResponse, SkillDraft,
  SkillListResponse, SkillOrigin, SkillPreview, SkillResponse, SkillSavedResponse, SkillStoreResponse }
  from './shared.ts';

export interface SkillListQuery { query?: string; offset?: number; limit?: number }
export interface SkillReadQuery { version?: string; path?: string; offset?: number; limit?: number }
export interface SkillsApi {
  list(query: SkillListQuery, signal?: AbortSignal): Promise<SkillListResponse>;
  read(name: string, query: SkillReadQuery, signal?: AbortSignal): Promise<SkillResponse>;
  /** DELETE /v2/skills/:name：装上的挪到 .removed 留底；内置的 409。 */
  remove(name: string, requestId: string): Promise<RemoveSkillResponse>;
  /** 技能页「添加」：商店清单（公开仓库里的一份）。 */
  store(signal?: AbortSignal): Promise<SkillStoreResponse>;
  /** 装之前先看：名字、什么时候用、全文、带哪些文件、有没有脚本。 */
  preview(from: SkillOrigin, signal?: AbortSignal): Promise<SkillPreview>;
  install(input: InstallSkillRequest): Promise<SkillSavedResponse>;
  /** 技能页「新建」：让 Plasticine 写一份草稿（不存）。 */
  draft(input: DraftSkillRequest, signal?: AbortSignal): Promise<SkillDraft>;
  create(input: CreateSkillRequest): Promise<SkillSavedResponse>;
}
