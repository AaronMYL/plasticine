// /v2/heartbeat（shared/api/heartbeat.ts，《优化清单》第 11 条）：「定时」里点开心跳那一行的弹层——读设置和最近几次、
// 改多久一次和清单（拖、删、加）、一句话改清单。写都按 requestId 幂等。都要本人会话。

import {
  HEARTBEAT_PATH,
  HEARTBEAT_SAY_PATH,
  HeartbeatSayRequestSchema,
  UpdateHeartbeatRequestSchema,
} from '../../shared/api/index.ts';
import { ChecklistError } from '../heartbeat/index.ts';
import { ApiError } from './api-error.ts';
import { requireUserAuth, type Reply, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

// 一句话改清单要等模型：最多等这么久。
const SAY_TIMEOUT_MS = 60_000;

function checklistCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof ChecklistError) {
      throw new ApiError(422, 'invalid_input', error.message);
    }
    throw error;
  }
}

/** GET /v2/heartbeat */
export function readHeartbeat(context: RequestContext): Reply {
  requireUserAuth(context);
  return { status: 200, body: context.deps.heartbeat.view() };
}

/** PUT /v2/heartbeat：多久一次、清单（整份）。 */
export async function updateHeartbeat(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const { requestId, ...change } = checkInput(UpdateHeartbeatRequestSchema, await readJsonBody(context.req), '改心跳');
  return idempotent(context, requestId, () => ({ status: 200,
    body: checklistCall(() => context.deps.heartbeat.update(change)) }));
}

/** POST /v2/heartbeat/say：一句话改清单（要等模型，不走幂等表：重发就是再改一次，改法一样结果一样）。 */
export async function sayToHeartbeat(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(HeartbeatSayRequestSchema, await readJsonBody(context.req), '改心跳的清单');
  let view;
  try {
    view = await context.deps.heartbeat.say(input.text, AbortSignal.timeout(SAY_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof ChecklistError) {
      throw new ApiError(422, 'invalid_input', error.message);
    }
    // 模型没答上来（没连模型、超时、答歪）：清单没改，他可以直接在清单里加一条。
    throw new ApiError(502, 'model_failed', error instanceof Error ? error.message : String(error),
      { next: '稍后再试，或者直接在清单里加一条。' });
  }
  return { status: 200, body: view };
}

export const HEARTBEAT_ROUTES: readonly Route[] = [
  { method: 'GET', path: HEARTBEAT_PATH, auth: true, handler: readHeartbeat },
  { method: 'PUT', path: HEARTBEAT_PATH, auth: true, handler: updateHeartbeat },
  { method: 'POST', path: HEARTBEAT_SAY_PATH, auth: true, handler: sayToHeartbeat },
];
