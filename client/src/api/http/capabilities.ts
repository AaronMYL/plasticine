import { RemoveSkillResponseSchema, SKILLS_PATH, SkillListResponseSchema, SkillResponseSchema } from '../shared.ts';
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
}
