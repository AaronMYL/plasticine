// 节点那一侧的接口（M5，协议写在 shared/api/devices.ts）：拿码换长期凭证（没有会话，码就是凭据）、带凭证报到拿上限。
// 凭证只出现在配对回答里；接口回执只记「这个 requestId 登记的是哪台节点」，回答丢了重发时换一张新凭证给同一台节点。
// 输错码和登录配对共用一个限流；限流在读完请求体之后才查（review-followups e4cef52 记的 session.ts 那条，这里照改过的写）。
// 凭证从 authorization 头来，不进 URL、不进日志。

import {
  NODE_CREDENTIAL_SCHEME,
  NODE_PAIR_PATH,
  NodeHelloRequestSchema,
  NodePairRequestSchema,
  PAIRING_REPLAY_WINDOW_MS,
  REPLAYED_HEADER,
  type NodeHelloResponse,
  type NodePairResponse,
} from '../../shared/api/index.ts';
import type { ApiRequestRecord, DeviceNode } from '../../shared/state.ts';
import { DeviceError, effectiveLimits, type PairedNode } from '../devices/index.ts';
import { ApiError } from './api-error.ts';
import type { AppDeps, Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

const PAIR_SCOPE = `POST ${NODE_PAIR_PATH}`;
const NEW_CODE_NEXT = '在 App 的「设备与度量 · 设备」里领一个新码。';

function pairReply(paired: PairedNode, replayed: boolean): Reply {
  const body: NodePairResponse = {
    nodeId: paired.node.id,
    credential: paired.credential,
    limits: effectiveLimits(paired.node),
    limitsVersion: paired.node.limitsVersion,
  };
  return { status: 201, body, ...(replayed ? { headers: { [REPLAYED_HEADER]: '1' } } : {}) };
}

function codeError(error: DeviceError): ApiError {
  const code = error.code === 'pairing_code_expired' ? 'pairing_code_expired' : 'pairing_code_used';
  return new ApiError(401, code, error.message, { field: 'code', next: NEW_CODE_NEXT });
}

function earlierPairing(deps: AppDeps, requestId: string, now: Date): ApiRequestRecord | undefined {
  const stored = deps.state.apiRequests.find(requestId);
  if (stored === undefined || Date.parse(stored.expiresAt) <= now.getTime()) {
    return undefined;
  }
  if (stored.scope !== PAIR_SCOPE) {
    throw new ApiError(409, 'request_id_reused', '这个 request_id 已经用在另一个操作上了。', { field: 'requestId' });
  }
  return stored;
}

/** POST /v2/nodes/pair */
export async function pairNodeHandler(context: RequestContext): Promise<Reply> {
  const { deps } = context;
  const body = checkInput(NodePairRequestSchema, await readJsonBody(context.req), '节点配对');
  // Checked, validated and counted in one synchronous stretch after the body was read: slow requests cannot slip in.
  if (deps.pairingLimiter.blocked()) {
    const minutes = Math.max(1, Math.ceil(deps.pairingLimiter.retryAfterMs() / 60_000));
    throw new ApiError(429, 'too_many_attempts', '配对码输错的次数太多，配对先停一会儿。', {
      next: `${minutes} 分钟后再试；${NEW_CODE_NEXT}`,
    });
  }
  const now = deps.now();
  const code = deps.devices.findCode(body.code);
  if (code === undefined) {
    deps.pairingLimiter.recordFailure();
    throw new ApiError(401, 'pairing_code_invalid', '配对码不对。', { field: 'code', next: NEW_CODE_NEXT });
  }
  const earlier = earlierPairing(deps, body.requestId, now);
  const earlierNode = earlier?.body;
  if (earlier !== undefined) {
    const nodeId = typeof earlierNode === 'object' && earlierNode !== null && 'nodeId' in earlierNode
      ? earlierNode.nodeId
      : undefined;
    if (typeof nodeId !== 'string' || code.nodeId !== nodeId) {
      throw new ApiError(409, 'request_id_reused', '这个 request_id 配对的是另一个码。', { field: 'requestId' });
    }
    return pairReply(deps.devices.reissue(nodeId), true);
  }
  try {
    const paired = deps.state.transaction(() => {
      const result = deps.devices.pair(code, body);
      deps.state.apiRequests.save({
        requestId: body.requestId,
        scope: PAIR_SCOPE,
        deviceId: null,
        status: 201,
        // Only which node this pairing registered: a replay gets a fresh credential, never a stored one.
        body: { nodeId: result.node.id },
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PAIRING_REPLAY_WINDOW_MS).toISOString(),
      });
      return result;
    });
    return pairReply(paired, false);
  } catch (error) {
    if (error instanceof DeviceError && error.code.startsWith('pairing_code_')) {
      if (error.code === 'pairing_code_used') {
        deps.pairingLimiter.recordFailure();
      }
      throw codeError(error);
    }
    throw error;
  }
}

/** The node behind `authorization: Bearer <credential>`, or a 401 that never echoes what was sent. */
export function requireNode(context: RequestContext): DeviceNode {
  const header = context.req.headers.authorization ?? '';
  const prefix = `${NODE_CREDENTIAL_SCHEME} `;
  const credential = header.startsWith(prefix) ? header.slice(prefix.length).trim() : '';
  const node = context.deps.devices.authenticate(credential);
  if (node === undefined) {
    throw new ApiError(401, 'node_credential_invalid', '这台节点的凭证不对，或者节点已经撤销了。', {
      next: '在 App 上领一个新码，重新配对这台节点。',
    });
  }
  return node;
}

/** POST /v2/nodes/hello */
export async function helloNodeHandler(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const body = checkInput(NodeHelloRequestSchema, await readJsonBody(context.req), '节点报到');
  // The body may have taken a while: a node revoked meanwhile gets nothing.
  const updated = context.deps.devices.hello(requireNode(context), body);
  const reply: NodeHelloResponse = {
    nodeId: updated.id,
    limits: effectiveLimits(updated),
    limitsVersion: updated.limitsVersion,
  };
  return { status: 200, body: reply };
}
