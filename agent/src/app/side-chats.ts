// 旧对话只读和表情；创建入口已由队友取代。
import { ReactLineMessageRequestSchema } from '../../shared/api/index.ts';
import { ApiError } from './api-error.ts';
import { param, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { kernel, lineCall } from './lines.ts';
import { checkInput } from './validate.ts';

export function openSideChat(context: RequestContext): Reply {
  kernel(context);
  throw new ApiError(410, 'gone', '新对话已改为队友，请从花名册建立队友。');
}

/** GET /v2/lines/chats */
export function listChats(context: RequestContext): Reply {
  return { status: 200, body: kernel(context).chats() };
}

/** POST /v2/lines/:id/reactions */
export async function reactLineMessage(context: RequestContext): Promise<Reply> {
  const lines = kernel(context);
  const input = checkInput(ReactLineMessageRequestSchema, await readJsonBody(context.req), '表情');
  const id = param(context, 'id');
  return idempotent(context, input.requestId, (afterCommit) => ({
    status: 200,
    body: { message: lineCall(() => lines.react(id, { seq: input.seq, emoji: input.emoji, on: input.on },
      afterCommit)) },
  }));
}
