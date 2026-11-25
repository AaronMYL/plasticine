import {
  ClaimGroupTaskRequestSchema,
  CreateGroupRequestSchema,
  GROUP_ID_PREFIX,
  GroupRequestSchema,
  UpdateGroupRequestSchema,
} from '../../shared/api/index.ts';
import type { Group, GroupTask } from '../../shared/state.ts';
import { checkAvatar } from '../network/index.ts';
import { notFoundError } from './api-error.ts';
import { requireNetwork, taskActivity, taskExecution } from './contacts.ts';
import { param, requireAuth, requireUserAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { groupRow, groupTaskView } from './group-views.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export function isGroupId(id: string): boolean {
  return id.startsWith(GROUP_ID_PREFIX);
}

export function requireGroupRow(deps: AppDeps, id: string): Group {
  const group = deps.state.groups.get(id);
  if (group === undefined) {
    throw notFoundError('这个群');
  }
  return group;
}

function requireGroupTask(deps: AppDeps, id: string): GroupTask {
  const task = deps.state.groupTasks.get(id);
  if (task === undefined) {
    throw notFoundError('这张任务卡');
  }
  return task;
}

export function getGroupTask(context: RequestContext): Reply {
  requireAuth(context);
  const { deps } = context;
  return { status: 200, body: { task: groupTaskView(deps.state, requireGroupTask(deps, param(context, 'id')),
    taskActivity(deps), taskExecution(deps)) } };
}

/** POST /v2/groups */
export async function createGroup(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(CreateGroupRequestSchema, await readJsonBody(context.req), '建群');
  const network = requireNetwork(context.deps);
  return idempotent(context, body.requestId, () => {
    const group = network.createGroup({ name: body.name ?? null, memberIds: body.memberIds,
      requestId: body.requestId });
    return { status: 201, body: { contact: groupRow(context.deps.state, group) } };
  });
}

/** POST /v2/groups/:id */
export async function updateGroup(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(UpdateGroupRequestSchema, await readJsonBody(context.req), '改群');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  requireGroupRow(context.deps, id);
  const avatar = body.avatar === undefined ? undefined : checkAvatar(body.avatar);
  return idempotent(context, body.requestId, () => {
    const group = network.updateGroup(id, { ...(body.name === undefined ? {} : { name: body.name }),
      ...(avatar === undefined ? {} : { avatar }), ...(body.addIds === undefined ? {} : { addIds: body.addIds }) });
    return { status: 200, body: { contact: groupRow(context.deps.state, group) } };
  });
}

/** POST /v2/groups/:id/leave */
export async function leaveGroup(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(GroupRequestSchema, await readJsonBody(context.req), '退群');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  requireGroupRow(context.deps, id);
  return idempotent(context, body.requestId, () => {
    const group = network.leaveGroup(id);
    return { status: 200, body: { contact: groupRow(context.deps.state, group) } };
  });
}

/** POST /v2/group-tasks/:id/claim */
export async function claimGroupTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ClaimGroupTaskRequestSchema, await readJsonBody(context.req), '接任务');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  requireGroupTask(context.deps, id);
  return idempotent(context, body.requestId, () => ({ status: 200,
    body: { task: groupTaskView(context.deps.state, network.claimGroupTask(id, body.doer)) } }));
}

/** POST /v2/group-tasks/:id/cancel */
export async function cancelGroupTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(GroupRequestSchema, await readJsonBody(context.req), '撤回任务');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  requireGroupTask(context.deps, id);
  return idempotent(context, body.requestId, () => ({ status: 200,
    body: { task: groupTaskView(context.deps.state, network.cancelGroupTask(id)) } }));
}
