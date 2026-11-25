import { Type, type Static } from 'typebox';
import { TIERS, type Tier } from './api/visibility.ts';

export const INDEX_KINDS = ['message', 'note', 'space', 'memory', 'bookmark', 'feed', 'book'] as const;
export const IndexKindSchema = Type.Enum(INDEX_KINDS);
export type IndexKind = Static<typeof IndexKindSchema>;

export const INDEX_LINE_KINDS = ['main', 'side', 'background'] as const;
export const IndexLineKindSchema = Type.Enum(INDEX_LINE_KINDS);
export type IndexLineKind = Static<typeof IndexLineKindSchema>;

export function tiersUpTo(maxTier: Tier): Tier[] {
  return TIERS.slice(0, TIERS.indexOf(maxTier) + 1);
}

export const CONVERSATION_SEARCH_LIMIT_MAX = 20;
export const ConversationSearchParameters = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 200,
    description: 'Words to find in what he or Plasticine said (Chinese works; 1–2 characters also work)' }),
  from: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'First day to include, YYYY-MM-DD in his time zone' })),
  to: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    description: 'Last day to include, YYYY-MM-DD in his time zone' })),
  lineKind: Type.Optional(Type.Enum(INDEX_LINE_KINDS,
    { description: 'Only this kind of line: main (the main conversation), side, background (work lines)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: CONVERSATION_SEARCH_LIMIT_MAX })),
}, { additionalProperties: false });
