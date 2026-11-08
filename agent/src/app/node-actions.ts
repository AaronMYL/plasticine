import {
  NODE_POLL_MAX_SECONDS, NODE_RESULT_MAX_BYTES, NodeActionResultRequestSchema, NodeNextActionQuerySchema,
} from '../../shared/api/index.ts';
import { param, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { requireNode } from './node-protocol.ts';
import { checkInput, queryObject } from './validate.ts';

export async function nextNodeAction(context: RequestContext): Promise<Reply> {
  const node = requireNode(context);
  const query = checkInput(NodeNextActionQuerySchema, queryObject(context.url.searchParams), '等待动作的参数');
  const controller = new AbortController();
  const closed = (): void => controller.abort();
  context.res.once('close', closed);
  try {
    const action = await context.deps.devices.nextAction(node.id, Number(query.wait ?? NODE_POLL_MAX_SECONDS),
      controller.signal);
    requireNode(context);
    return action === null ? { status: 204 } : { status: 200, body: { action } };
  } finally {
    context.res.off('close', closed);
  }
}

export async function reportNodeAction(context: RequestContext): Promise<Reply> {
  requireNode(context);
  const body = checkInput(NodeActionResultRequestSchema,
    await readJsonBody(context.req, NODE_RESULT_MAX_BYTES), '节点动作结果');
  const node = requireNode(context);
  context.deps.devices.reportResult(node.id, param(context, 'id'), body);
  return { status: 200, body: {} };
}
