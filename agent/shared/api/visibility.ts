// /v2/visibility: 对外可见（第 113 条）。四档 公开 / 合作 / 朋友 / 私密；没标的一律私密。三类联系人各自能听到的档位
// 是固定的台阶：陌生人 公开；合作方 公开 + 合作；朋友 公开 + 合作 + 朋友。Plasticine 建议的标注要用户确认才算。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { CONTACT_RELATIONS, type ContactRelation } from './contacts.ts';

export const VISIBILITY_PATH = `${API_PREFIX}/visibility`;
export const VISIBILITY_MARKS_PATH = `${VISIBILITY_PATH}/marks`;
export const VISIBILITY_CONFIRM_PATH = `${VISIBILITY_PATH}/confirm`;

export const TIERS = ['public', 'partner', 'friend', 'private'] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Readonly<Record<Tier, string>> = {
  public: '公开',
  partner: '合作',
  friend: '朋友',
  private: '私密',
};
/** 每类联系人能听到哪几档。 */
export const RELATION_REACH: Readonly<Record<ContactRelation, readonly Tier[]>> = {
  stranger: ['public'],
  partner: ['public', 'partner'],
  friend: ['public', 'partner', 'friend'],
};
// 第 6 条（11-06）：空间带档位，默认私密。
export const MATERIAL_KINDS = ['memory_topic', 'project', 'note', 'space'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MaterialRowSchema = Type.Object({
  kind: Type.Enum(MATERIAL_KINDS),
  id: IdSchema,
  title: Type.String(),
  tier: Type.Enum(TIERS),
  /** Plasticine 建议的档位，等用户确认；没有建议是 null。 */
  proposed: OrNull(Type.Enum(TIERS)),
  version: Type.Integer({ minimum: 0 }),
});
export type MaterialRow = Static<typeof MaterialRowSchema>;

export const VisibilityResponseSchema = Type.Object({
  relations: Type.Array(Type.Object({
    relation: Type.Enum(CONTACT_RELATIONS),
    count: Type.Integer({ minimum: 0 }),
  })),
  materials: Type.Array(MaterialRowSchema),
  /** 等用户确认的建议条数。 */
  pending: Type.Integer({ minimum: 0 }),
});
export type VisibilityResponse = Static<typeof VisibilityResponseSchema>;

export const SetMarkRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  kind: Type.Enum(MATERIAL_KINDS),
  id: IdSchema,
  tier: Type.Enum(TIERS),
  version: Type.Integer({ minimum: 0 }),
});
export const ConfirmMarksRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  /** 不给 = 全部确认。 */
  items: Type.Optional(Type.Array(Type.Object({ kind: Type.Enum(MATERIAL_KINDS), id: IdSchema }))),
});
