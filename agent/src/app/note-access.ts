import { UnlockNoteRequestSchema } from '../../shared/api/index.ts';
import { unauthorized } from './api-error.ts';
import { stillAuthenticated } from './auth.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

/** 旧客户端兼容：配对会话本来即可读笔记，不登记解锁、本人确认或请求回执。 */
export async function unlockNote(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  checkInput(UnlockNoteRequestSchema, await readJsonBody(context.req), '读取笔记');
  if (!stillAuthenticated(context.deps, auth)) throw unauthorized();
  context.deps.state.notes.require(param(context, 'id'));
  return { status: 200, body: { unlocked: true } };
}
