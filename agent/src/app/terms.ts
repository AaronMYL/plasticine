import { CreateTermRequestSchema, ProposeTermRequestSchema } from '../../shared/api/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { agreementView } from './cognition-views.ts';
import { param, requireAuth, type RequestContext, type Reply } from './context.ts';
import { readJsonBodyWithDigest } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export async function createTerm(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const { requestId, ...input } = checkInput(CreateTermRequestSchema, raw.value, '新词');
  return idempotent(
    context,
    requestId,
    (afterCommit) => {
      const change = { actor: auth.actor === 'system' ? 'system' as const : 'user' as const,
        actorRef: auth.device.id, reason: '保存新词，待设备确认生效' };
      const row = context.deps.state.agreements.create(input, change);
      const agreement = agreementView(row);
      afterCommit(() => context.deps.hub.publish({ type: 'agreement_changed', agreement }));
      return { status: 201, body: { agreement } };
    },
    { bodyDigest: raw.digest },
  );
}

export async function proposeTerm(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const raw = await readJsonBodyWithDigest(context.req);
  const { requestId, version, ...definition } = checkInput(ProposeTermRequestSchema, raw.value, '词语提议');
  const id = param(context, 'id');
  return idempotent(
    context,
    requestId,
    (afterCommit) => {
      const current = context.deps.state.agreements.get(id);
      if (current === undefined || current.kind !== 'term') {
        throw notFoundError('这个词');
      }
      if (current.version !== version) {
        throw new ApiError(409, 'version_conflict', '这个词已经改过，请重新读取后再保存提议。');
      }
      const proposedDiff = `- ${current.title ?? ''} · ${current.scope} · ${current.termTier ?? '待补'} · ${current.text}
+ ${definition.title} · ${definition.scope} · ${definition.termTier} · ${definition.text}`;
      const row = context.deps.state.agreements.update(
        id,
        version,
        { proposedTerm: definition, proposedDiff },
        {
          actor: auth.actor === 'system' ? 'system' : 'user',
          actorRef: auth.device.id,
          reason: '保存词语提议，现行定义继续有效',
        },
      );
      const agreement = agreementView(row);
      afterCommit(() => context.deps.hub.publish({ type: 'agreement_changed', agreement }));
      return { status: 200, body: { agreement } };
    },
    { bodyDigest: raw.digest },
  );
}

export function termDecodings(context: RequestContext): Reply {
  requireAuth(context);
  const id = param(context, 'id');
  if (context.deps.state.agreements.get(id)?.kind !== 'term') {
    throw notFoundError('这个词');
  }
  return { status: 200, body: { decodings: context.deps.state.termDecodings.list(id) } };
}
