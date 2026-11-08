import { ClientUpdateDecisionSchema } from '../../shared/api/index.ts';
import { param, requireAuth, type RequestContext, type Reply } from './context.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';
export function listClientUpdates(context: RequestContext): Reply {
  requireAuth(context);
  context.deps.clientUpdates.scan();
  return { status: 200, body: context.deps.clientUpdates.view(), headers: { 'Cache-Control': 'no-store' } };
}
export async function decideClientUpdate(context: RequestContext): Promise<Reply> {
  requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const body = checkInput(ClientUpdateDecisionSchema, raw.value, '客户端发布提请');
  context.deps.clientUpdates.scan();
  return idempotent(
    context,
    body.requestId,
    () => ({ status: 200, body: context.deps.clientUpdates.decide(param(context, 'id'), body) }),
    { bodyDigest: raw.digest },
  );
}

export function previewClientUpdate(context: RequestContext): Reply {
  requireAuth(context);
  const file = context.params['asset'] === undefined ? 'index.html' : `assets/${param(context, 'asset')}`;
  return { status: 200, bytes: { ...context.deps.clientUpdates.preview(param(context, 'id'), file), noStore: true } };
}
