// /v2/skills：技能目录和读一个技能（技能页，原来在设置 · AI）。2026-11-05 能力清单（capabilities 工具和接口）随旧工具一起删了。
// 11-13 加「添加」和「新建」：/v2/skill-store 商店清单、/v2/skill-preview 装之前先看、/v2/skill-install 装、
// /v2/skill-draft 让 Plasticine 写草稿、POST /v2/skills 存自己写的。

import { SkillReadSchema, SkillSearchSchema } from '../../shared/skills.ts';
import { CreateSkillRequestSchema, DraftSkillRequestSchema, InstallSkillRequestSchema, RemoveSkillRequestSchema,
  SkillPreviewRequestSchema, type RemoveSkillResponse, type SkillListResponse, type SkillResponse, type SkillRow,
  type SkillSavedResponse, type SkillStoreResponse } from '../../shared/api/index.ts';
import type { SkillDescriptor } from '../../shared/skills.ts';
import { TextModelError } from '../kernel/index.ts';
import { draftSkill, hasScripts, previewOf, skillDocument, SkillInstallError, SkillRemoveError, SkillShopError,
  skillTitle, type DraftMaterial } from '../skills/index.ts';
import { plainText } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, idempotentAsync } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

/** 列表里的一行：目录摘要 + 用过几次 + 给人看的名字（SKILL.md 里的 title）。 */
function skillRow(context: RequestContext, skill: SkillDescriptor): SkillRow {
  const usage = context.deps.skills.usage()[skill.name];
  let title: string | null = null;
  try {
    title = skillTitle(context.deps.skills.read({ name: skill.name, version: skill.version, limit: 2_000 }, null).text);
  } catch {
    title = null;
  }
  return { ...skill, uses: usage?.count ?? 0, lastUsedAt: usage?.lastUsedAt ?? null, title };
}

const SHOP_TIMEOUT_MS = 40_000;
const DRAFT_TIMEOUT_MS = 90_000;
const DRAFT_TRACE_ROWS = 80;
const DRAFT_TRACE_LINE_CHARS = 600;
const DRAFT_TRACE_CHARS = 8_000;

export function listSkills(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(SkillSearchSchema, queryObject(context.url.searchParams,
    { offset: 'integer', limit: 'integer' }), '技能查询');
  const catalog = context.deps.skills.search(query.query);
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 20;
  const rows = catalog.skills.slice(offset, offset + limit).map((skill) => skillRow(context, skill));
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

/** 商店、网址读不到或内容不合规：一句给人看的原因。 */
function shopFailure(error: unknown): never {
  if (error instanceof SkillShopError) {
    throw new ApiError(error.code === 'unreachable' ? 502 : error.code === 'not_found' ? 404 : 400,
      error.code === 'unreachable' ? 'upstream_failed' : error.code === 'not_found' ? 'not_found' : 'invalid_request',
      error.message);
  }
  throw error;
}

function installed(context: RequestContext, name: string): boolean {
  return context.deps.skills.search().skills.some((skill) => skill.name === name);
}

/** GET /v2/skill-store：商店清单（公开仓库里的一份），标出哪些已经装了、哪些带脚本。 */
export async function listSkillStore(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const names = new Set(context.deps.skills.search().skills.map((skill) => skill.name));
  const skills = await context.deps.skillShop.catalog(AbortSignal.timeout(SHOP_TIMEOUT_MS)).catch(shopFailure);
  const body: SkillStoreResponse = { skills: skills.map((skill) => ({ ...skill, scripts: hasScripts(skill.files),
    installed: names.has(skill.name) })) };
  return { status: 200, body };
}

/** POST /v2/skill-preview：装之前先看（不落盘）。 */
export async function previewSkill(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(SkillPreviewRequestSchema, await readJsonBody(context.req), '看技能');
  const bundle = await context.deps.skillShop.bundle(body.from, AbortSignal.timeout(SHOP_TIMEOUT_MS))
    .catch(shopFailure);
  return { status: 200, body: { preview: previewOf(bundle, installed(context, bundle.name)) } };
}

function saved(context: RequestContext, work: () => SkillDescriptor): Reply {
  try {
    return { status: 201, body: { skill: skillRow(context, work()) } satisfies SkillSavedResponse };
  } catch (error) {
    if (error instanceof SkillInstallError) {
      throw new ApiError(409, 'conflict', error.message);
    }
    if (error instanceof Error && !(error instanceof ApiError)) {
      throw new ApiError(400, 'invalid_request', error.message);
    }
    throw error;
  }
}

/** POST /v2/skill-install：从商店、网址或一组文件装一个技能。 */
export async function installSkill(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(InstallSkillRequestSchema, await readJsonBody(context.req), '装技能');
  return idempotentAsync(context, body.requestId, async () => {
    const bundle = await context.deps.skillShop.bundle(body.from, AbortSignal.timeout(SHOP_TIMEOUT_MS))
      .catch(shopFailure);
    return saved(context, () => context.deps.skills.install(bundle.name, bundle.files, bundle.origin,
      body.replace === true));
  });
}

/** POST /v2/skills：存一个自己写（或改过草稿）的技能；已经有同名的 409。 */
export async function createSkill(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(CreateSkillRequestSchema, await readJsonBody(context.req), '新建技能');
  return idempotent(context, body.requestId, () => saved(context, () => context.deps.skills.install(body.name,
    { 'SKILL.md': Buffer.from(skillDocument(body)).toString('base64') }, 'user')));
}

/** 做成过的那条线的经过：他说的、Plasticine 说的，各截一段，最多这么多字。 */
function doneMaterial(context: RequestContext, lineId: string): DraftMaterial['done'] {
  const line = context.deps.state.lines.get(lineId);
  if (line === undefined) {
    throw notFoundError('这件事');
  }
  const rows = context.deps.state.lineMessages.page(lineId, null, DRAFT_TRACE_ROWS).rows;
  const said = rows.flatMap((row) => {
    const text = plainText(row.message).trim();
    if (text === '' || (row.role !== 'user' && row.role !== 'assistant')) { return []; }
    return [`${row.role === 'user' ? '交代' : 'Plasticine'}：${text.slice(0, DRAFT_TRACE_LINE_CHARS)}`];
  });
  return { title: line.title, conclusion: line.conclusion,
    trace: said.join('\n').slice(0, DRAFT_TRACE_CHARS) };
}

/** POST /v2/skill-draft：让 Plasticine 写一份草稿（不存）。 */
export async function draftSkillRequest(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const body = checkInput(DraftSkillRequestSchema, await readJsonBody(context.req), '写技能草稿');
  const said = body.said?.trim() ?? '';
  if (said === '' && body.lineId === undefined) {
    throw new ApiError(400, 'invalid_request', '先说一句想让 Plasticine 学会什么，或者挑一件做成过的事。');
  }
  const material: DraftMaterial = { said, done: body.lineId === undefined ? null : doneMaterial(context, body.lineId) };
  try {
    return { status: 200, body: { draft: await draftSkill(context.deps.text, material,
      AbortSignal.timeout(DRAFT_TIMEOUT_MS)) } };
  } catch (error) {
    if (error instanceof ApiError) { throw error; }
    const message = error instanceof TextModelError && error.kind === 'no_model'
      ? '还没有连接模型，连上以后再让 Plasticine 写；也可以选「自己写」。'
      : error instanceof Error && !(error instanceof TextModelError) ? error.message : '草稿没写成，稍后再试；也可以选「自己写」。';
    throw new ApiError(502, 'upstream_failed', message);
  }
}
