import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';
import { SOUL_SECTIONS, SOUL_SOURCES } from './soul.ts';
import { SoulOwnerSchema } from './souls.ts';

export const RULES_MOVE_PATH = `${API_PREFIX}/memory/rules-move`;
export const RULES_MOVE_DEST_KINDS = ['about_you', 'soul', 'product'] as const;
export const RULES_MOVE_MAX = 200;

export const RulesMoveDestSchema = Type.Object({
  kind: Type.Enum(RULES_MOVE_DEST_KINDS),
  owner: Type.Union([SoulOwnerSchema, Type.Null()]),
}, { additionalProperties: false });
export type RulesMoveDest = Static<typeof RulesMoveDestSchema>;

export const RulesMoveItemSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 0 }),
  text: Type.String(),
  moved: Type.String(),
  section: Type.Enum(SOUL_SECTIONS),
  source: Type.Enum(SOUL_SOURCES),
  dest: RulesMoveDestSchema,
  suggested: Type.Boolean(),
}, { additionalProperties: false });
export type RulesMoveItem = Static<typeof RulesMoveItemSchema>;

export const RulesMoveOwnerSchema = Type.Object({
  owner: SoulOwnerSchema,
  name: Type.String(),
}, { additionalProperties: false });

export const RulesMoveResponseSchema = Type.Object({
  items: Type.Array(RulesMoveItemSchema),
  owners: Type.Array(RulesMoveOwnerSchema),
}, { additionalProperties: false });
export type RulesMoveResponse = Static<typeof RulesMoveResponseSchema>;

export const ApplyRulesMoveRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  moves: Type.Array(Type.Object({
    id: IdSchema,
    version: Type.Integer({ minimum: 0 }),
    dest: RulesMoveDestSchema,
  }, { additionalProperties: false }), { minItems: 1, maxItems: RULES_MOVE_MAX }),
}, { additionalProperties: false });
export type ApplyRulesMoveRequest = Static<typeof ApplyRulesMoveRequestSchema>;

export const ApplyRulesMoveResponseSchema = Type.Object({
  moved: Type.Integer({ minimum: 0 }),
  remaining: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type ApplyRulesMoveResponse = Static<typeof ApplyRulesMoveResponseSchema>;
