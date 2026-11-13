import { DraftSkillResponseSchema, RemoveSkillResponseSchema, SKILL_DRAFT_PATH, SKILL_INSTALL_PATH, SKILL_PREVIEW_PATH,
  SKILL_STORE_PATH, SKILLS_PATH, SkillListResponseSchema, SkillPreviewResponseSchema, SkillResponseSchema,
  SkillSavedResponseSchema, SkillStoreResponseSchema, type CreateSkillRequest, type DraftSkillRequest,
  type InstallSkillRequest, type SkillOrigin } from '../shared.ts';
import type { SkillsApi, SkillListQuery, SkillReadQuery } from '../capabilities-client.ts';
import type { Transport } from './transport.ts';

export class HttpSkills implements SkillsApi {
  private readonly transport: Transport;
  constructor(transport: Transport) { this.transport = transport; }
  list(query: SkillListQuery, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: SKILLS_PATH, query: { ...query },
      schema: SkillListResponseSchema, what: '读取技能目录', lostAs: 'failed', signal });
  }
  read(name: string, query: SkillReadQuery, signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: `${SKILLS_PATH}/${encodeURIComponent(name)}`,
      query: { ...query }, schema: SkillResponseSchema, what: '读取技能', lostAs: 'failed', signal });
  }
  remove(name: string, requestId: string) {
    return this.transport.request({ method: 'DELETE', path: `${SKILLS_PATH}/${encodeURIComponent(name)}`,
      body: { requestId }, schema: RemoveSkillResponseSchema, what: '删技能', lostAs: 'uncertain' });
  }
  store(signal?: AbortSignal) {
    return this.transport.request({ method: 'GET', path: SKILL_STORE_PATH, schema: SkillStoreResponseSchema,
      what: '读技能商店', lostAs: 'failed', signal });
  }
  async preview(from: SkillOrigin, signal?: AbortSignal) {
    return (await this.transport.request({ method: 'POST', path: SKILL_PREVIEW_PATH, body: { from },
      schema: SkillPreviewResponseSchema, what: '看这个技能', lostAs: 'failed', signal })).preview;
  }
  install(input: InstallSkillRequest) {
    return this.transport.request({ method: 'POST', path: SKILL_INSTALL_PATH, body: input,
      schema: SkillSavedResponseSchema, what: '装技能', lostAs: 'uncertain' });
  }
  async draft(input: DraftSkillRequest, signal?: AbortSignal) {
    return (await this.transport.request({ method: 'POST', path: SKILL_DRAFT_PATH, body: input,
      schema: DraftSkillResponseSchema, what: '写技能草稿', lostAs: 'failed', signal })).draft;
  }
  create(input: CreateSkillRequest) {
    return this.transport.request({ method: 'POST', path: SKILLS_PATH, body: input,
      schema: SkillSavedResponseSchema, what: '存技能', lostAs: 'uncertain' });
  }
}
