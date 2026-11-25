import { PUSHES_RECENT, PushWithdrawRequestSchema, pushTag } from '../../shared/api/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { pushRecord } from './push-tool.ts';
import { checkInput } from './validate.ts';

export function withdrawnText(title: string): string {
  const chars = Array.from(title);
  return `「${chars.length > 20 ? `${chars.slice(0, 20).join('')}…` : title}」这条推送已撤回`;
}

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
    const before = state.pushes.get(input.id);
    const push = pushRecord(state, state.pushes.withdraw(input.id));
    context.deps.hub.publish({ type: 'pushes_changed' });
    if (before?.withdrawnAt === null) {
      void context.deps.push.announce({ title: 'Plasticine', body: withdrawnText(push.title), url: push.url,
        tag: pushTag(push.id) }).catch((error: unknown) => {
        safeLog('error', 'push_withdraw_failed', { category: errorCategory(error) });
      });
    }
    return { status: 200, body: { push } };
  });
}
