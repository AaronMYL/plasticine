import { WorkLimitRequestSchema, type WorkLimitView } from '../../shared/api/account.ts';
import { BACKGROUND_LIMIT_KEY, readWorkLimit } from '../lines/index.ts';
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

export async function putWorkLimit(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(WorkLimitRequestSchema, await readJsonBody(context.req), '同时做几件事');
  context.deps.state.kernelSettings.set(BACKGROUND_LIMIT_KEY, input.setting);
  context.deps.lines.reschedule();
  return { status: 200, body: view(context) };
}
