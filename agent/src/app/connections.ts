import {
  ConnectionActionRequestSchema, ConnectionCreateRequestSchema, ConnectionUpdateRequestSchema,
} from '../../shared/api/index.ts';
import { param, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent, idempotentAsync } from './idempotency.ts';
import { checkInput } from './validate.ts';

function closing(context: RequestContext): AbortSignal {
  const gone = new AbortController();
  context.res.once('close', () => gone.abort());
  return gone.signal;
}

function changed(context: RequestContext): void {
  context.deps.hub.publish({ type: 'connections_changed' });
}

export function listConnections(context: RequestContext): Reply {
  requireUserAuth(context);
  return { status: 200, body: { connections: context.deps.toolGroups.connections.views() } };
}

export async function createConnection(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(ConnectionCreateRequestSchema, await readJsonBody(context.req), '连接');
  return idempotentAsync(context, input.requestId, async () => {
    const connection = await context.deps.toolGroups.connections.create({ name: input.name, url: input.url,
      ...(input.token === undefined ? {} : { token: input.token }) }, closing(context));
    changed(context);
    return { status: 200, body: { connection } };
  });
}

export async function updateConnection(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(ConnectionUpdateRequestSchema, await readJsonBody(context.req), '连接');
  return idempotentAsync(context, input.requestId, async () => {
    const { requestId: _request, ...patch } = input;
    const connection = await context.deps.toolGroups.connections.update(param(context, 'id'), patch,
      closing(context));
    changed(context);
    return { status: 200, body: { connection } };
  });
}

export async function testConnection(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  checkInput(ConnectionActionRequestSchema, await readJsonBody(context.req), '测试');
  const connection = await context.deps.toolGroups.connections.test(param(context, 'id'), closing(context));
  changed(context);
  return { status: 200, body: { connection } };
}

export async function deleteConnection(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(ConnectionActionRequestSchema, await readJsonBody(context.req), '删除');
  return idempotent(context, input.requestId, () => {
    context.deps.toolGroups.connections.remove(param(context, 'id'));
    changed(context);
    return { status: 200, body: { connections: context.deps.toolGroups.connections.views() } };
  });
}
