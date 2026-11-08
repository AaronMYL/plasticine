// /v2/nodes（M5，App 这一侧）：执行节点列表、领一次性配对码（本人会话）、撤销、改设备侧上限（用户确认字段）、最近的设备
// 动作。领码的回答里有明文的码，所以它不经通用的接口回执存回答（idempotency.ts 会把回答体存进库）：这里只记「这个
// requestId 领到的是哪个码」，同一个请求重发时作废旧码、换一个新码——旧码从没送到过你手里。

import {
  IssueNodePairingCodeRequestSchema,
  NODE_PAIRING_CODES_PATH,
  NodeActionListQuerySchema,
  REPLAYED_HEADER,
  RevokeNodeRequestSchema,
  SetNodeLimitsRequestSchema,
  IDEMPOTENCY_WINDOW_MS,
  type NodeActionListResponse,
  type NodeListResponse,
  type NodePairingCodeResponse,
  type NodeResponse,
} from '../../shared/api/index.ts';
import { DEFAULT_DEVICE_LIMITS, DeviceError, PROTECTED_DEVICE_PATHS } from '../devices/index.ts';
import { MAX_PAGE_SIZE } from '../state/index.ts';
import { ApiError, unauthorized } from './api-error.ts';
import { stillAuthenticated } from './auth.ts';
import { param, requireAuth, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { confirmedWrite, userConfirmation } from './user-confirmation.ts';
import { nodeActionView, nodeView } from './device-views.ts';
import { readJsonBody, readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

// The device page shows the latest actions; older ones stay in the library.
const RECENT_ACTIONS = 50;
const CODE_SCOPE = `POST ${NODE_PAIRING_CODES_PATH}`;

/** GET /v2/nodes */
export function listNodes(context: RequestContext): Reply {
  requireAuth(context);
  const { state, now } = context.deps;
  const at = now();
  const body: NodeListResponse = {
    nodes: state.nodes.list({ limit: MAX_PAGE_SIZE }).map((node) => nodeView(state, node, at)),
    defaults: DEFAULT_DEVICE_LIMITS,
    protectedPaths: PROTECTED_DEVICE_PATHS.map((rule) => `${rule.pattern}（${rule.why}）`),
  };
  return { status: 200, body };
}

/** GET /v2/nodes/actions?nodeId= */
export function listNodeActions(context: RequestContext): Reply {
  requireAuth(context);
  const query = checkInput(NodeActionListQuerySchema, queryObject(context.url.searchParams), '设备动作列表的参数');
  const rows = context.deps.state.nodeActions.recent(query.nodeId ?? null, { limit: RECENT_ACTIONS });
  const body: NodeActionListResponse = { actions: rows.map(nodeActionView) };
  return { status: 200, body };
}

function reused(): ApiError {
  return new ApiError(409, 'request_id_reused', '这个 request_id 已经用在另一个操作上了，没有执行。', {
    field: 'requestId',
    next: '每次领码生成一个新的 request_id；回答丢了重发才用原来的。',
  });
}

/** POST /v2/nodes/pairing-codes（本人会话确认） */
export async function issueNodePairingCode(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(IssueNodePairingCodeRequestSchema, raw.value, '领节点配对码');
  const confirmation = userConfirmation(context);
  const { state, devices, now } = context.deps;
  if (!stillAuthenticated(context.deps, auth)) {
    throw unauthorized('这台设备的登录在请求途中失效了，这次没有执行。');
  }
  const at = now();
  const stored = state.apiRequests.find(body.requestId);
  const live = stored !== undefined && Date.parse(stored.expiresAt) > at.getTime();
  if (live && (stored.scope !== CODE_SCOPE || stored.bodyDigest !== raw.digest)) {
    throw reused();
  }
  const issued = state.transaction(() => {
    const earlier = live ? stored.body : null;
    if (typeof earlier === 'object' && earlier !== null && 'codeId' in earlier && typeof earlier.codeId === 'string') {
      devices.voidCode(earlier.codeId);
    }
    const code = devices.issueCode(confirmation.deviceId);
    state.apiRequests.save({
      requestId: body.requestId,
      scope: CODE_SCOPE,
      deviceId: auth.device.id,
      status: 201,
      // Which code this request got, never the code itself.
      body: { codeId: code.codeId },
      createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + IDEMPOTENCY_WINDOW_MS).toISOString(),
      bodyDigest: raw.digest,
    });
    return code;
  });
  const reply: NodePairingCodeResponse = { code: issued.code, expiresAt: issued.expiresAt };
  return { status: 201, body: reply, ...(live ? { headers: { [REPLAYED_HEADER]: '1' } } : {}) };
}

/** POST /v2/nodes/:id/revoke — revoking twice answers the same. */
export async function revokeNodeHandler(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(RevokeNodeRequestSchema, await readJsonBody(context.req), '撤销节点');
  const id = param(context, 'id');
  const { state, devices, now } = context.deps;
  return idempotent(context, body.requestId, (after) => {
    const node = devices.revoke(id, auth.device.id, after);
    const reply: NodeResponse = { node: nodeView(state, node, now()) };
    return { status: 200, body: reply };
  });
}

/** POST /v2/nodes/:id/limits（本人会话确认）: 设备侧上限是用户确认字段。 */
export function setNodeLimitsHandler(context: RequestContext): Promise<Reply> {
  const id = param(context, 'id');
  const { state, devices, now } = context.deps;
  const check = (value: unknown) => checkInput(SetNodeLimitsRequestSchema, value, '改节点上限');
  return confirmedWrite(context, check, (body, confirmation, after) => {
    try {
      const node = devices.setLimits(id, body.limitsVersion, body.limits, confirmation, after);
      const reply: NodeResponse = { node: nodeView(state, node, now()) };
      return { status: 200, body: reply };
    } catch (error) {
      const current = state.nodes.get(id);
      if (error instanceof DeviceError && error.code === 'version_conflict' && current !== undefined) {
        throw new ApiError(409, 'version_conflict', error.message, {
          next: '先看现在的上限，再改。',
          extra: { current: nodeView(state, current, now()) },
        });
      }
      throw error;
    }
  });
}
