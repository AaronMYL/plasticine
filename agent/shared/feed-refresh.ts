import { Type, type Static } from 'typebox';
import { DaySchema } from './state-daily.ts';
import { IsoTimeSchema, Nullable } from './state-common.ts';

export const FeedRefreshSchema = Type.Object({
  requestId: Type.String({ minLength: 1 }),
  day: DaySchema,
  status: Type.Enum(['queued', 'running', 'completed', 'failed']),
  startedAt: Nullable(IsoTimeSchema),
  finishedAt: Nullable(IsoTimeSchema),
  added: Type.Integer({ minimum: 0 }),
  error: Nullable(Type.String()),
}, { additionalProperties: false });
export type FeedRefresh = Static<typeof FeedRefreshSchema>;
