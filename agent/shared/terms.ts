import { Type, type Static } from 'typebox';

export const TERM_TIERS = ['exact', 'metaphor', 'borrowed'] as const;
export const TERM_TIER_LABELS = { exact: '精确', metaphor: '比喻', borrowed: '借词' } as const;
export const TermTierSchema = Type.Enum(TERM_TIERS);
export const TermDefinitionSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 120 }),
    text: Type.String({ minLength: 1, maxLength: 20000 }),
    scope: Type.String({ maxLength: 2000 }),
    termTier: TermTierSchema,
  },
  { additionalProperties: false },
);
export type TermDefinition = Static<typeof TermDefinitionSchema>;

export const TermDecodingSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    termId: Type.String({ minLength: 1 }),
    termVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    anchor: Type.Union([
      Type.Object(
        {
          kind: Type.Enum(['message', 'note']),
          ref: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    text: Type.String({ minLength: 1, maxLength: 20000 }),
    author: Type.Enum(['user', 'brain', 'migration']),
    createdAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type TermDecoding = Static<typeof TermDecodingSchema>;
