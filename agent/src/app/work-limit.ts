// 同时做几件事（设置 · AI，11-12 全量优化第 2 条）：读、改后台线的并发上限。算法在 lines/capacity.ts。

import { WorkLimitRequestSchema, type WorkLimitView } from '../../shared/api/account.ts';
import { BACKGROUND_LIMIT_KEY, readWorkLimit } from '../lines/capacity.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

function view(context: RequestContext): WorkLimitView {
  return { setting: readWorkLimit(context.deps.state), effective: context.deps.lines.backgroundLimit() };
}

/** GET /v2/account/work-limit */
export function getWorkLimit(context: RequestContext): Reply {
  requireUserAuth(context);
  return { status: 200, body: view(context) };
}

/** PUT /v2/account/work-limit：改了马上生效——调大了，排着队的事接着开跑；调小了，在跑的做完为止，不掐。 */
export async function putWorkLimit(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(WorkLimitRequestSchema, await readJsonBody(context.req), '同时做几件事');
  context.deps.state.kernelSettings.set(BACKGROUND_LIMIT_KEY, input.setting);
  context.deps.lines.reschedule();
  return { status: 200, body: view(context) };
}
