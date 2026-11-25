import {
  MEMORY_GRANTS_PATH, MEMORY_LOOP_GRANT_REVOKE_PATH, RevokeLoopGrantRequestSchema, type MemoryGrantsResponse,
} from '../../shared/api/memory-grants.ts';
import { requireAuth, requireUserAuth, type RequestContext, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

function view(context: RequestContext): MemoryGrantsResponse {
  return { loop: context.deps.state.loop.grants.list()
    .map((grant) => ({ id: grant.id, topic: grant.topic, grantedAt: grant.grantedAt })) };
}

export const MEMORY_GRANTS_ROUTES: readonly Route[] = [
  { method: 'GET', path: MEMORY_GRANTS_PATH, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: view(context) };
  } },
  { method: 'POST', path: MEMORY_LOOP_GRANT_REVOKE_PATH, auth: true, async handler(context: RequestContext) {
    requireUserAuth(context);
    const body = checkInput(RevokeLoopGrantRequestSchema, await readJsonBody(context.req), '收回一类放手');
    return idempotent(context, body.requestId, () => {
      context.deps.state.loop.grants.revoke(body.topic, '他在承诺和授权里收回');
      return { status: 200, body: view(context) };
    });
  } },
];
