import { TimerStopRequestSchema } from '../../shared/api/index.ts';
import { ApiError } from './api-error.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export async function stopTimer(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(TimerStopRequestSchema, await readJsonBody(context.req), '关掉');
  const timers = context.deps.lineTimers;
  if (timers === null) {
    throw new ApiError(404, 'not_found', '这台实例没有开「回来看」和「盯着」。');
  }
  return idempotent(context, input.requestId, () => {
    timers.cancel(input.id);
    return { status: 200, body: { timers: timers.views() } };
  });
}
