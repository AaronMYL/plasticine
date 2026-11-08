import { Type, type Static } from 'typebox';
import { FeedCommentSchema } from '../feed-comments.ts';
import { RequestIdSchema } from './common.ts';

export const AddFeedCommentRequestSchema = Type.Object({
  requestId: RequestIdSchema, text: Type.String({ minLength: 1, maxLength: 10_000, pattern: '\\S' }),
}, { additionalProperties: false });
export type AddFeedCommentRequest = Static<typeof AddFeedCommentRequestSchema>;
export const RetryFeedCommentRequestSchema = Type.Object({ requestId: RequestIdSchema },
  { additionalProperties: false });
export type RetryFeedCommentRequest = Static<typeof RetryFeedCommentRequestSchema>;
export const FeedCommentsResponseSchema = Type.Object({ comments: Type.Array(FeedCommentSchema) });
export type FeedCommentsResponse = Static<typeof FeedCommentsResponseSchema>;
export const BlockFeedSiteRequestSchema = Type.Object({
  requestId: RequestIdSchema, site: Type.String({ minLength: 1, maxLength: 253 }), blocked: Type.Boolean(),
}, { additionalProperties: false });
export type BlockFeedSiteRequest = Static<typeof BlockFeedSiteRequestSchema>;
export { FeedCommentSchema };
export type { FeedComment } from '../feed-comments.ts';
