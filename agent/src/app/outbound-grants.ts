import { CreateOutboundGrantRequestSchema, EditOutboundGrantRequestSchema, RevokeOutboundGrantRequestSchema }
  from '../../shared/api/outbound.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { notFoundError } from './api-error.ts';
import { confirmedWrite } from './user-confirmation.ts';
import { checkInput } from './validate.ts';

export function listOutboundGrants(context: RequestContext): Reply {
  requireAuth(context);
  return { status: 200, body: { grants: context.deps.state.outboundGrants.list() } };
}

export function listOutboundLog(context: RequestContext): Reply {
  requireAuth(context);
  const entries = context.deps.state.outboundLog.list(context.url.searchParams.get('grantId'));
  return { status: 200, body: { entries } };
}

export function getOutboundLog(context: RequestContext): Reply {
  requireAuth(context);
  const entry = context.deps.state.outboundLog.get(param(context, 'id'));
  if (entry === undefined) { throw notFoundError('这条发送记录'); }
  return { status: 200, body: { entry } };
}

export function createOutboundGrant(context: RequestContext): Promise<Reply> {
  return confirmedWrite(context, (raw) => checkInput(CreateOutboundGrantRequestSchema, raw, '对外授权'),
    (body, confirmation) => ({ status: 201,
      body: { grant: context.deps.state.outboundGrants.create(body.grant, confirmation) } }));
}

export function editOutboundGrant(context: RequestContext): Promise<Reply> {
  return confirmedWrite(context, (raw) => checkInput(EditOutboundGrantRequestSchema, raw, '修改授权'),
    (body, confirmation) => ({ status: 200,
      body: { grant: context.deps.state.outboundGrants.edit(param(context, 'id'), body.version,
        body.patch, confirmation) } }));
}

export function revokeOutboundGrant(context: RequestContext): Promise<Reply> {
  return confirmedWrite(context, (raw) => checkInput(RevokeOutboundGrantRequestSchema, raw, '撤销授权'),
    (body, confirmation) => ({ status: 200,
      body: { grant: context.deps.state.outboundGrants.revoke(param(context, 'id'), body.version, confirmation) } }));
}
