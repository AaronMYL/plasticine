import type { RemoveSkillResponse, SkillListResponse, SkillResponse } from './shared.ts';

export interface SkillListQuery { query?: string; offset?: number; limit?: number }
export interface SkillReadQuery { version?: string; path?: string; offset?: number; limit?: number }
export interface SkillsApi {
  list(query: SkillListQuery, signal?: AbortSignal): Promise<SkillListResponse>;
  read(name: string, query: SkillReadQuery, signal?: AbortSignal): Promise<SkillResponse>;
  /** DELETE /v2/skills/:name：装上的挪到 .removed 留底；内置的 409。 */
  remove(name: string, requestId: string): Promise<RemoveSkillResponse>;
}
