// /v2/lines：新内核的线（shared/api/lines.ts）。列线、读一条线（分页）、发消息、撤回 / 立即发送排队的消息、叫停、
// 重试。写都带 requestId，24 小时内重发回同一个结果、不重做；开跑和推事件在事务提交之后（idempotency.ts）。

import {
  LineCommandRequestSchema,
  LineDetailsQuerySchema,
  ListLinesQuerySchema,
  ReadLineQuerySchema,
  SendLineMessageRequestSchema,
  LINE_PAGE_DEFAULT,
} from '../../shared/api/index.ts';
import { LineError, type LineKernel } from '../lines/index.ts';
import { lineDetails } from '../lines/details.ts';
import { matesFor } from './mates.ts';
import { ApiError } from './api-error.ts';
import { resolveConversationQuotes } from './conversation-quotes.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput, queryObject } from './validate.ts';

// 列线默认带这么多条：主对话加最近的后台线。
const LIST_DEFAULT = 50;

export function kernel(context: RequestContext): LineKernel {
  requireAuth(context);
  const lines = context.deps.lines;
  if (lines === null) {
    throw new ApiError(503, 'not_configured', '新内核还没装上。', { next: '这一版服务没有带线；更新服务后再试。' });
  }
  return lines;
}

/** 内核的拒绝换成接口的错误格式：没有这条线 404，状态不对 409，输入不对 400。 */
export function lineCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (!(error instanceof LineError)) {
      throw error;
    }
    const details = error.next === undefined ? {} : { next: error.next };
    if (error.code === 'not_found') {
      throw new ApiError(404, 'not_found', error.message, details);
    }
    if (error.code === 'conflict') {
      throw new ApiError(409, 'conflict', error.message, details);
    }
    throw new ApiError(400, 'invalid_request', error.message, details);
  }
}

/** GET /v2/lines?kind=&limit= */
export function listLines(context: RequestContext): Reply {
  const lines = kernel(context);
  const query = checkInput(ListLinesQuerySchema,
    queryObject(context.url.searchParams, { limit: 'integer', includeArchived: 'boolean' }), '线列表');
  const filter = { limit: query.limit ?? LIST_DEFAULT, includeArchived: query.includeArchived ?? false,
    ...(query.kind === undefined ? {} : { kind: query.kind }) };
  return { status: 200, body: { lines: lines.list(filter) } };
}

/** GET /v2/lines/:id?before=&limit= */
export function readLine(context: RequestContext): Reply {
  const lines = kernel(context);
  const query = checkInput(ReadLineQuerySchema,
    queryObject(context.url.searchParams, { limit: 'integer', before: 'integer' }), '读线');
  const id = param(context, 'id');
  return { status: 200, body: lineCall(() => lines.read(id, query.limit ?? LINE_PAGE_DEFAULT, query.before ?? null)) };
}

/** GET /v2/lines/:id/details：工作要求、原话、项目和完整成果历史。 */
export function readLineDetails(context: RequestContext): Reply {
  const lines = kernel(context);
  const query = checkInput(LineDetailsQuerySchema,
    queryObject(context.url.searchParams, { limit: 'integer', before: 'integer' }), '工作详情');
  const line = lineCall(() => lines.view(param(context, 'id')));
  return { status: 200, body: lineDetails(context.deps.state, line, query) };
}

/** POST /v2/lines/:id/messages：空闲开一轮，在跑进排队。 */
export async function sendLineMessage(context: RequestContext): Promise<Reply> {
  const lines = kernel(context);
  const auth = requireAuth(context);
  const input = checkInput(SendLineMessageRequestSchema, await readJsonBody(context.req), '消息');
  const id = param(context, 'id');
  return idempotent(context, input.requestId, (afterCommit) => {
    const text = resolveConversationQuotes(context.deps.state, input.text, input.quotes);
    if (text.trim() === '' && (input.attachments?.length ?? 0) === 0) {
      throw new ApiError(400, 'invalid_request', '消息是空的。', { field: 'text' });
    }
    const message = { text, origin: auth.actor === 'system'
      ? { kind: 'system' as const, ref: auth.device.id } : { kind: 'user' as const, userText: input.text },
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo.seq }),
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }) };
    return { status: 200, body: lineCall(() => matesFor(context).route(id, message, afterCommit)
      ?? lines.send(id, message, afterCommit)) };
  });
}

async function command(context: RequestContext, work: (lines: LineKernel, after: (action: () => void) => void)
  => unknown): Promise<Reply> {
  const lines = kernel(context);
  const input = checkInput(LineCommandRequestSchema, await readJsonBody(context.req), '操作');
  return idempotent(context, input.requestId, (afterCommit) => ({
    status: 200,
    body: lineCall(() => work(lines, afterCommit)),
  }));
}

/** POST /v2/lines/:id/queue/:queueId/withdraw */
export function withdrawQueued(context: RequestContext): Promise<Reply> {
  return command(context, (lines, after) => lines.withdraw(param(context, 'id'), param(context, 'queueId'), after));
}

/** POST /v2/lines/:id/queue/:queueId/send-now */
export function sendQueuedNow(context: RequestContext): Promise<Reply> {
  return command(context, (lines, after) => lines.sendNow(param(context, 'id'), param(context, 'queueId'), after));
}

/** POST /v2/lines/:id/stop */
export function stopLine(context: RequestContext): Promise<Reply> {
  return command(context, (lines, after) => ({ line: lines.halt(param(context, 'id'), after) }));
}

/** POST /v2/lines/:id/retry */
export function retryLine(context: RequestContext): Promise<Reply> {
  return command(context, (lines, after) => ({ line: lines.retry(param(context, 'id'), after) }));
}

/** 归档与恢复复用命令幂等及配对会话，不永久删除历史。 */
export function archiveLine(context: RequestContext): Promise<Reply> {
  return command(context, (lines, after) => ({ line: lines.archive(param(context, 'id'), after) }));
}

export function restoreLine(context: RequestContext): Promise<Reply> {
  return command(context, (lines, after) => ({ line: lines.restore(param(context, 'id'), after) }));
}
