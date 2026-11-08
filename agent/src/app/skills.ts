// /v2/skills：技能目录和读一个技能（设置 · AI ·「技能」）。2026-11-05 能力清单（capabilities 工具和接口）随旧工具一起删了。

import { SkillReadSchema, SkillSearchSchema } from '../../shared/skills.ts';
import { RemoveSkillRequestSchema, type RemoveSkillResponse, type SkillListResponse, type SkillResponse }
  from '../../shared/api/index.ts';
import { SkillRemoveError } from '../skills/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

export function listSkills(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(SkillSearchSchema, queryObject(context.url.searchParams,
    { offset: 'integer', limit: 'integer' }), '技能查询');
  const catalog = context.deps.skills.search(query.query);
  const usage = context.deps.skills.usage();
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 20;
  const rows = catalog.skills.slice(offset, offset + limit).map((skill) => ({ ...skill,
    uses: usage[skill.name]?.count ?? 0, lastUsedAt: usage[skill.name]?.lastUsedAt ?? null }));
  const body: SkillListResponse = { skills: rows, issues: catalog.issues,
    total: catalog.skills.length, nextOffset: offset + limit < catalog.skills.length ? offset + limit : null };
  return { status: 200, body };
}

export function getSkill(context: RequestContext): Reply {
  requireAuth(context);
  const input = checkInput(SkillReadSchema, { name: param(context, 'name'),
    ...queryObject(context.url.searchParams, { offset: 'integer', limit: 'integer' }) }, '技能读取');
  if (input.version === undefined && !context.deps.skills.search().skills.some((skill) => skill.name === input.name)) {
    throw notFoundError('这个技能');
  }
  try {
    const skill = context.deps.skills.read(input, null);
    return { status: 200, body: { skill } satisfies SkillResponse };
  } catch {
    throw new ApiError(400, 'invalid_request', '无法读取这个技能版本或资源，请检查名称、版本和相对路径。');
  }
}

/** DELETE /v2/skills/:name */
export async function removeSkill(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const name = param(context, 'name');
  const body = checkInput(RemoveSkillRequestSchema, await readJsonBody(context.req), '删技能');
  return idempotent(context, body.requestId, () => {
    try {
      context.deps.skills.remove(name);
    } catch (error) {
      if (error instanceof SkillRemoveError) {
        throw error.reason === 'builtin' ? new ApiError(409, 'conflict', error.message) : notFoundError('这个技能');
      }
      throw error;
    }
    return { status: 200, body: { name } satisfies RemoveSkillResponse };
  });
}
