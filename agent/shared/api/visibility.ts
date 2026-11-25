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
export const RELATION_REACH: Readonly<Record<ContactRelation, readonly Tier[]>> = {
  stranger: ['public'],
  partner: ['public', 'partner'],
  friend: ['public', 'partner', 'friend'],
};
export const MATERIAL_KINDS = ['memory_topic', 'project', 'note', 'space'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MaterialRowSchema = Type.Object({
  kind: Type.Enum(MATERIAL_KINDS),
  id: IdSchema,
  title: Type.String(),
  tier: Type.Enum(TIERS),
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
  items: Type.Optional(Type.Array(Type.Object({ kind: Type.Enum(MATERIAL_KINDS), id: IdSchema }))),
});
