import { Type, type Static } from 'typebox';
import { IsoTimeSchema } from './state-common.ts';

export const FeedCommentSchema = Type.Object({
  id: Type.String(), itemId: Type.String(), author: Type.Enum(['user', 'ai']),
  text: Type.String(), createdAt: IsoTimeSchema,
  replyTo: Type.Union([Type.String(), Type.Null()]),
  status: Type.Enum(['pending', 'completed', 'failed']),
  error: Type.Union([Type.String(), Type.Null()]), migrated: Type.Boolean(),
  version: Type.Integer({ minimum: 1 }),
});
export type FeedComment = Static<typeof FeedCommentSchema>;

export const FeedCommentReplySchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 4000 }),
  level: Type.Union([Type.Literal('more'), Type.Literal('less'), Type.Null()]),
}, { additionalProperties: false });
export type FeedCommentReply = Static<typeof FeedCommentReplySchema>;
export interface FeedCommentInput {
  item: { title: string; summary: string; url: string | null };
  source: { label: string; interest: boolean; level: string };
  previous: { author: 'user' | 'ai'; text: string }[];
  text: string;
}
export type FeedCommentGenerator = (input: FeedCommentInput, signal: AbortSignal) => Promise<FeedCommentReply>;
