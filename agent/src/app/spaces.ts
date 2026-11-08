// /v2/spaces（shared/api/spaces.ts，《优化清单》第 6 条）：资料库里的空间。读列表、读一个、他直接改（存成新的一版，
// 作者记他；改名也走这里）、撤销最近一版、删除进「最近删除」和还原（11-08）、笔记 AI 的续写和补充（和笔记同一个助手）。
// 写都按 requestId 幂等、带 version（还原不带：删掉的不会再被改）。

import {
  DeleteSpaceRequestSchema,
  NoteAssistRequestSchema,
  RestoreSpaceRequestSchema,
  SaveSpaceRequestSchema,
  SPACE_LIST_STANDALONE_PARAM,
  UndoSpaceRequestSchema,
  type SpaceListResponse,
} from '../../shared/api/index.ts';
import type { Space } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { writeSpace } from '../subs/index.ts';
import { notFoundError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { spaceListItem, spaceView } from './space-views.ts';
import { checkInput } from './validate.ts';

// 资料库第二栏一次给这么多个：再多该分页了。
const LIST_MAX = 200;

function requireSpace(state: StateService, id: string): Space {
  const space = state.spaces.get(id);
  if (space === undefined || space.deletedAt !== null) {
    throw notFoundError('这个空间');
  }
  return space;
}

/** GET /v2/spaces[?standalone=true] */
export function listSpaces(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const standalone = context.url.searchParams.get(SPACE_LIST_STANDALONE_PARAM) === 'true';
  const body: SpaceListResponse = { spaces: state.spaces.list({ standalone }, { limit: LIST_MAX })
    .map((space) => spaceListItem(state, space)) };
  return { status: 200, body };
}

/** GET /v2/spaces/:id */
export function getSpace(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  return { status: 200, body: spaceView(state, requireSpace(state, param(context, 'id'))) };
}

/** PUT /v2/spaces/:id：他在空间里直接改。 */
export async function saveSpace(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(SaveSpaceRequestSchema, await readJsonBody(context.req), '保存空间');
  const { state } = context.deps;
  const space = requireSpace(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    const saved = writeSpace(state, { id: space.id, version: body.version, title: body.title ?? space.title,
      doc: body.doc }, 'user');
    return { status: 200, body: spaceView(state, saved) };
  });
}

/** POST /v2/spaces/:id/undo：撤回最近一版（Plasticine 刚改的一期点「撤销」）。 */
export async function undoSpace(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(UndoSpaceRequestSchema, await readJsonBody(context.req), '撤销');
  const { state } = context.deps;
  const space = requireSpace(state, param(context, 'id'));
  return idempotent(context, body.requestId, () =>
    ({ status: 200, body: spaceView(state, state.spaces.undo(space.id, body.version, 'user')) }));
}

/** DELETE /v2/spaces/:id：移到「最近删除」（只打删除时间）。 */
export async function deleteSpace(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(DeleteSpaceRequestSchema, await readJsonBody(context.req), '删除空间');
  const { state } = context.deps;
  const space = requireSpace(state, param(context, 'id'));
  return idempotent(context, body.requestId, () => {
    state.spaces.markDeleted(space.id, body.version);
    return { status: 200, body: { deleted: true } };
  });
}

/** POST /v2/spaces/:id/restore：从「最近删除」还原。 */
export async function restoreSpace(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(RestoreSpaceRequestSchema, await readJsonBody(context.req), '还原空间');
  const { state } = context.deps;
  const id = param(context, 'id');
  if (state.spaces.get(id) === undefined) {
    throw notFoundError('这个空间');
  }
  return idempotent(context, body.requestId, () =>
    ({ status: 200, body: spaceView(state, state.spaces.restore(id)) }));
}

/** POST /v2/spaces/:id/assist：续写、补充（和笔记共用一个助手，正文没有改动，建议由他采用）。 */
export async function assistSpace(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  requireSpace(context.deps.state, param(context, 'id'));
  const input = checkInput(NoteAssistRequestSchema, await readJsonBody(context.req), '空间里的续写');
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  context.res.once('close', abort);
  try {
    return { status: 200, body: await context.deps.noteAssistant.suggest(input, controller.signal) };
  } finally {
    context.res.off('close', abort);
  }
}
