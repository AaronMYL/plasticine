// GET /v2/pushes、POST /v2/pushes/withdraw（shared/api/pushes.ts）：推到手机的记录，看最近的、撤回一条。要本人会话。
// 撤回时给开着系统通知的设备再推一条同一个 tag 的「已撤回」：手机上那条原样换掉（新旧 service worker 都按 tag 换，
// 不响也不震）；开着的网页、桌面版收到 pushes_changed 也把这台设备上挂着的那条收掉。

import { PUSHES_RECENT, PushWithdrawRequestSchema, pushTag } from '../../shared/api/index.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { pushRecord } from './push-tool.ts';
import { checkInput } from './validate.ts';

/** 换掉手机上那条用的一句：说清楚是哪条撤回了。 */
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
