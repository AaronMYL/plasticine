// GET /v2/pushes、POST /v2/pushes/withdraw（shared/api/pushes.ts）：推到手机的记录，看最近的、撤回一条。要本人会话。

import { PUSHES_RECENT, PushWithdrawRequestSchema } from '../../shared/api/index.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { pushRecord } from './push-tool.ts';
import { checkInput } from './validate.ts';

export function listPushes(context: RequestContext): Reply {
  requireUserAuth(context);
  const { state } = context.deps;
  return { status: 200, body: { pushes: state.pushes.recent(PUSHES_RECENT).map((row) => pushRecord(state, row)) } };
}

export async function withdrawPush(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(PushWithdrawRequestSchema, await readJsonBody(context.req), '撤回');
  return idempotent(context, input.requestId, () => {
    const { state } = context.deps;
    const push = pushRecord(state, state.pushes.withdraw(input.id));
    context.deps.hub.publish({ type: 'pushes_changed' });
    return { status: 200, body: { push } };
  });
}
