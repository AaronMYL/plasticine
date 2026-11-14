// 规则搬家（第13批，shared/api/rules-move.ts）：列出还在「规则」里的每一条和建议去处；照他勾的搬（走请求回执）。

import { createHash } from 'node:crypto';
import { ApplyRulesMoveRequestSchema, RULES_MOVE_PATH } from '../../shared/api/rules-move.ts';
import { applyRulesMove, rulesMoveView } from '../brain/rules-move.ts';
import { mainIdentity } from '../mates/main-identity.ts';
import { requireAuth, requireUserAuth, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';

export const RULES_MOVE_ROUTES: readonly Route[] = [
  { method: 'GET', path: RULES_MOVE_PATH, auth: true, handler(context) {
    requireAuth(context);
    const { state } = context.deps;
    return { status: 200, body: rulesMoveView(state, mainIdentity(state).name) };
  } },
  { method: 'POST', path: RULES_MOVE_PATH, auth: true, async handler(context) {
    const auth = requireUserAuth(context);
    const input = checkInput(ApplyRulesMoveRequestSchema, await readJsonBody(context.req), '规则搬家');
    return idempotent(context, input.requestId, () => ({ status: 200,
      body: applyRulesMove(context.deps.state, input.moves, { actor: 'user', ref: auth.device.id }) }),
    { bodyDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex') });
  } },
];
