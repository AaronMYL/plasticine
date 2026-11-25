import type { SoulsApi } from '../souls-client.ts';
import { ApplyRulesMoveResponseSchema, RULES_MOVE_PATH, RulesMoveResponseSchema, SOULS_PATH, SoulResponseSchema,
  SoulRevisionDiffResponseSchema } from '../shared.ts';
import type { Transport } from './transport.ts';

const path = (owner: string): string => `${SOULS_PATH}/${encodeURIComponent(owner)}`;

export function createSoulsHttp(transport: Transport): SoulsApi {
  return {
    get: (owner, signal) => transport.request({ method: 'GET', path: path(owner), schema: SoulResponseSchema,
      what: '读取 Soul', lostAs: 'failed', signal }),
    update: (owner, body) => transport.request({ method: 'POST', path: path(owner), body, schema: SoulResponseSchema,
      what: '改 Soul', lostAs: 'uncertain' }),
    undo: (owner, body) => transport.request({ method: 'POST', path: `${path(owner)}/undo`, body,
      schema: SoulResponseSchema, what: '撤回这次改动', lostAs: 'uncertain' }),
    revision: (owner, id, signal) => transport.request({ method: 'GET',
      path: `${path(owner)}/revisions/${encodeURIComponent(id)}`, schema: SoulRevisionDiffResponseSchema,
      what: '读取这次改动', lostAs: 'failed', signal }),
    rulesMove: (signal) => transport.request({ method: 'GET', path: RULES_MOVE_PATH, schema: RulesMoveResponseSchema,
      what: '读取规则搬家清单', lostAs: 'failed', signal }),
    applyRulesMove: (body) => transport.request({ method: 'POST', path: RULES_MOVE_PATH, body,
      schema: ApplyRulesMoveResponseSchema, what: '搬规则', lostAs: 'uncertain' }),
  };
}
