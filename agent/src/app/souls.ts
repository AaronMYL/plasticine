// 主线和每位队友的 Soul（第13批，shared/api/souls.ts）：读、他改、撤回一次、看一次改了什么。改和撤回走请求回执（同一个
// requestId 再发不重做）。

import { createHash } from 'node:crypto';
import { SOULS_PATH, UndoSoulRequestSchema, UpdateSoulRequestSchema } from '../../shared/api/souls.ts';
import { soulResponse, soulRevisionDiff, undoSoul, updateSoul } from '../mates/souls.ts';
import { param, requireAuth, requireUserAuth, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

function digest(value: unknown) {
  return { bodyDigest: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

export const SOULS_ROUTES: readonly Route[] = [
  { method: 'GET', path: `${SOULS_PATH}/:owner`, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: soulResponse(context.deps.state, param(context, 'owner')) };
  } },
  { method: 'POST', path: `${SOULS_PATH}/:owner`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(UpdateSoulRequestSchema, await readJsonBody(context.req), 'Soul');
    const owner = param(context, 'owner');
    return idempotent(context, input.requestId, () => ({ status: 200,
      body: updateSoul(context.deps.state, owner, input.version, input.text, 'user', '你改的') }), digest(input));
  } },
  { method: 'POST', path: `${SOULS_PATH}/:owner/undo`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(UndoSoulRequestSchema, await readJsonBody(context.req), '撤回');
    const owner = param(context, 'owner');
    return idempotent(context, input.requestId, () => ({ status: 200,
      body: undoSoul(context.deps.state, owner, input.revisionId) }), digest(input));
  } },
  { method: 'GET', path: `${SOULS_PATH}/:owner/revisions/:id`, auth: true, handler(context) {
    requireAuth(context);
    return { status: 200, body: soulRevisionDiff(context.deps.state, param(context, 'owner'), param(context, 'id')) };
  } },
];
