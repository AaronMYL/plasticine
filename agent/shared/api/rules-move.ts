// 规则搬家（第13批，11-14 Aaron 选「按三层分，你勾了才搬」）：记忆页原来的「规则」按三层分开——他说过的偏好进
// 「关于你」，说话方式和相处中形成的判断进各自的 Soul（主线或那位队友），硬线和对外授权本来就在产品里（设置 ·
// 隐私与授权），那几条可以拿掉。Claude 先分一遍、给出建议去处，他勾了才搬；没勾的留在原处，下次整理再问。
//   GET  /v2/memory/rules-move → { items, owners }：还在「规则」里的每一条、建议搬去哪、搬过去写成什么样；
//   POST /v2/memory/rules-move { requestId, moves } → { moved, remaining }：照他勾的搬。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';
import { SOUL_SECTIONS, SOUL_SOURCES } from './soul.ts';
import { SoulOwnerSchema } from './souls.ts';

export const RULES_MOVE_PATH = `${API_PREFIX}/memory/rules-move`;
/** about_you：进「关于你」；soul：进主线或某位队友的 Soul；product：产品里本来就有，拿掉。 */
export const RULES_MOVE_DEST_KINDS = ['about_you', 'soul', 'product'] as const;
export type RulesMoveDestKind = (typeof RULES_MOVE_DEST_KINDS)[number];
export const RULES_MOVE_MAX = 200;

export const RulesMoveDestSchema = Type.Object({
  kind: Type.Enum(RULES_MOVE_DEST_KINDS),
  /** 进哪份 Soul（main 或队友 id）；别的去处是 null。 */
  owner: Type.Union([SoulOwnerSchema, Type.Null()]),
}, { additionalProperties: false });
export type RulesMoveDest = Static<typeof RulesMoveDestSchema>;

export const RulesMoveItemSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 0 }),
  /** 现在「规则」里写的。 */
  text: Type.String(),
  /** 进 Soul 时写成的样子（「用户」换成「我」）；进别处照原样。 */
  moved: Type.String(),
  section: Type.Enum(SOUL_SECTIONS),
  source: Type.Enum(SOUL_SOURCES),
  dest: RulesMoveDestSchema,
  /** 默认勾不勾：产品里本来就有的那几条默认不勾（拿掉要他自己定）。 */
  suggested: Type.Boolean(),
}, { additionalProperties: false });
export type RulesMoveItem = Static<typeof RulesMoveItemSchema>;

export const RulesMoveOwnerSchema = Type.Object({
  owner: SoulOwnerSchema,
  name: Type.String(),
}, { additionalProperties: false });

export const RulesMoveResponseSchema = Type.Object({
  items: Type.Array(RulesMoveItemSchema),
  /** 能搬进的几份 Soul：主线和在用的队友。 */
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
