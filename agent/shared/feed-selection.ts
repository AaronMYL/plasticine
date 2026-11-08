import { Type, type Static } from 'typebox';

export const FEED_SELECTION_LIMIT = 12;
export const FeedCandidateSchema = Type.Object({
  id: Type.String(), sourceId: Type.String(), sourceLabel: Type.String(), title: Type.String(),
  url: Type.String(), text: Type.String(), publishedAt: Type.Union([Type.String(), Type.Null()]),
  site: Type.String(), undated: Type.Boolean(), via: Type.String(), weight: Type.Number({ minimum: 0.5 }),
  subscriptionId: Type.Optional(Type.String()),
}, { additionalProperties: false });
export type FeedCandidate = Static<typeof FeedCandidateSchema>;
export const FeedSelectionInputSchema = Type.Object({
  candidates: Type.Array(FeedCandidateSchema),
  interests: Type.Array(Type.Object({ id: Type.String(), label: Type.String(),
    query: Type.Union([Type.String(), Type.Null()]) })),
  reactions: Type.Array(Type.Object({ title: Type.String(), source: Type.String(), reaction: Type.String() })),
});
export type FeedSelectionInput = Static<typeof FeedSelectionInputSchema>;
export const FeedSelectionSchema = Type.Object({
  items: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    sourceId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    summary: Type.String({ minLength: 1, maxLength: 2_000 }),
    why: Type.String({ minLength: 1, maxLength: 500 }),
    event: Type.String({ minLength: 1, maxLength: 300 }),
  }, { additionalProperties: false }), { maxItems: FEED_SELECTION_LIMIT }),
}, { additionalProperties: false });
export type FeedSelection = Static<typeof FeedSelectionSchema>;
export type FeedSelector = (input: FeedSelectionInput, signal: AbortSignal) => Promise<FeedSelection>;
