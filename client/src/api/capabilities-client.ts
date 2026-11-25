import type { CreateSkillRequest, DraftSkillRequest, InstallSkillRequest, RemoveSkillResponse, SkillDraft,
  SkillListResponse, SkillOrigin, SkillPreview, SkillResponse, SkillSavedResponse, SkillStoreResponse }
  from './shared.ts';

export interface SkillListQuery { query?: string; offset?: number; limit?: number }
export interface SkillReadQuery { version?: string; path?: string; offset?: number; limit?: number }
export interface SkillsApi {
  list(query: SkillListQuery, signal?: AbortSignal): Promise<SkillListResponse>;
  read(name: string, query: SkillReadQuery, signal?: AbortSignal): Promise<SkillResponse>;
  remove(name: string, requestId: string): Promise<RemoveSkillResponse>;
  store(signal?: AbortSignal): Promise<SkillStoreResponse>;
  preview(from: SkillOrigin, signal?: AbortSignal): Promise<SkillPreview>;
  install(input: InstallSkillRequest): Promise<SkillSavedResponse>;
  draft(input: DraftSkillRequest, signal?: AbortSignal): Promise<SkillDraft>;
  create(input: CreateSkillRequest): Promise<SkillSavedResponse>;
}
