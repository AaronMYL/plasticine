import {
  CreateInviteRequestSchema,
  DecideNetworkTaskRequestSchema,
  DeliverNetworkTaskRequestSchema,
  JoinNetworkRequestSchema,
  NetworkTaskVersionRequestSchema,
  SetAvatarRequestSchema,
  VerdictNetworkTaskRequestSchema,
  type NetworkStatus,
} from '../../shared/api/index.ts';
import type { NetworkTask } from '../../shared/state.ts';
import { notFoundError } from './api-error.ts';
import { withCurrent } from './conflict.ts';
import { networkTaskView } from './contact-views.ts';
import { checkAvatar, isLoopback } from '../network/index.ts';
import { requireNetwork, taskActivity, taskExecution } from './contacts.ts';
import { param, requireAuth, requireUserAuth, type AppDeps, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, idempotentAsync } from './idempotency.ts';
import { checkInput } from './validate.ts';

function maybeFirstOnRelay(relayUrl: string): boolean {
  return isLoopback(relayUrl);
}

export function networkStatus(deps: AppDeps): NetworkStatus {
  const network = requireNetwork(deps);
  const identity = network.identity();
  const relayUrl = network.relayUrl();
  return {
    joined: identity !== undefined,
    relayUrl,
    account: identity === undefined ? null : { id: identity.accountId, handle: identity.handle,
      displayName: identity.displayName, joinedAt: identity.joinedAt, avatar: identity.avatar,
      host: network.publicHost(identity.handle) },
    lastSyncAt: identity?.lastSyncAt ?? null,
    lastError: identity?.lastError ?? null,
    inviteNeeded: false,
    welcome: identity === undefined && deps.tunnel !== null && !maybeFirstOnRelay(relayUrl)
      && deps.state.lineMessages.page(deps.state.lines.main().id, null, 1).rows.length === 0,
    tunnel: tunnelStatus(deps),
  };
}

type TunnelView = { state: 'off' | 'connecting' | 'ready' | 'error'; detail: string | null } | null;

function tunnelStatus(deps: AppDeps): TunnelView {
  const tunnel = deps.tunnel;
  if (tunnel === null) {
    return null;
  }
  const status = tunnel.status();
  if (status.state === 'idle') {
    return { state: 'off', detail: null };
  }
  if (status.state === 'connected' && tunnel.certified()) {
    return { state: 'ready', detail: status.host };
  }
  if (status.lastError !== null && status.state === 'waiting') {
    return { state: 'error', detail: status.lastError };
  }
  return { state: 'connecting', detail: status.host };
}

export async function setNetworkAvatar(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(SetAvatarRequestSchema, await readJsonBody(context.req), '换头像');
  const network = requireNetwork(context.deps);
  const avatar = checkAvatar(body.avatar);
  return idempotent(context, body.requestId, () => {
    network.setAvatar(avatar);
    return { status: 200, body: networkStatus(context.deps) };
  });
}

/** GET /v2/network */
export function getNetwork(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: networkStatus(context.deps) };
}

/** POST /v2/network/join */
export async function joinNetwork(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(JoinNetworkRequestSchema, await readJsonBody(context.req), '加入网络');
  const network = requireNetwork(context.deps);
  return idempotentAsync(context, body.requestId, async () => {
    await network.join({ handle: body.handle, displayName: body.displayName.trim(),
      inviteCode: body.inviteCode ?? null, relayUrl: body.relayUrl ?? null });
    return { status: 201, body: networkStatus(context.deps) };
  });
}

/** POST /v2/network/invites */
export async function createNetworkInvite(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(CreateInviteRequestSchema, await readJsonBody(context.req), '生成邀请码');
  const network = requireNetwork(context.deps);
  return idempotentAsync(context, body.requestId, async () => ({ status: 201,
    body: await network.createInvite(body.requestId) }));
}

/** GET /v2/network/invites */
export async function listNetworkInvites(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  return { status: 200, body: { invites: await requireNetwork(context.deps).invites() } };
}

function requireTask(deps: AppDeps, id: string): NetworkTask {
  const task = deps.state.networkTasks.get(id);
  if (task === undefined) {
    throw notFoundError('这项任务');
  }
  return task;
}

/** GET /v2/network-tasks/:id */
export function getNetworkTask(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: { task: networkTaskView(requireTask(context.deps, param(context, 'id')),
    taskActivity(context.deps), taskExecution(context.deps)) } };
}

function taskWrite(context: RequestContext, requestId: string, write: () => NetworkTask): Reply {
  const { deps } = context;
  const id = param(context, 'id');
  requireTask(deps, id);
  const activity = taskActivity(deps);
  const execution = taskExecution(deps);
  return idempotent(context, requestId, () => {
    const task = withCurrent(write, () => networkTaskView(requireTask(deps, id), activity, execution),
      () => requireTask(deps, id).version);
    return { status: 200, body: { task: networkTaskView(task, activity, execution) } };
  });
}

export async function cancelNetworkTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(NetworkTaskVersionRequestSchema, await readJsonBody(context.req), '撤回');
  const network = requireNetwork(context.deps);
  return taskWrite(context, body.requestId, () => network.cancelTask(param(context, 'id'), body.version));
}

export async function stopNetworkTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(NetworkTaskVersionRequestSchema, await readJsonBody(context.req), '停止');
  const network = requireNetwork(context.deps);
  return taskWrite(context, body.requestId, () => network.stopTask(param(context, 'id'), body.version));
}

/** POST /v2/network-tasks/:id/decide */
export async function decideNetworkTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(DecideNetworkTaskRequestSchema, await readJsonBody(context.req), '表态');
  const network = requireNetwork(context.deps);
  return taskWrite(context, body.requestId, () => network.decideTask(param(context, 'id'), body.version,
    body.decision));
}

/** POST /v2/network-tasks/:id/deliver */
export async function deliverNetworkTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(DeliverNetworkTaskRequestSchema, await readJsonBody(context.req), '交付');
  const network = requireNetwork(context.deps);
  return taskWrite(context, body.requestId, () => network.deliverTask(param(context, 'id'), body.version,
    body.text));
}

/** POST /v2/network-tasks/:id/verdict */
export async function verdictNetworkTask(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(VerdictNetworkTaskRequestSchema, await readJsonBody(context.req), '验收');
  const network = requireNetwork(context.deps);
  return taskWrite(context, body.requestId, () => network.verdictTask(param(context, 'id'), body.version,
    body.verdict, body.note?.trim() ?? ''));
}
