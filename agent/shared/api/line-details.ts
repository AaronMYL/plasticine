// 工作详情：长期保留的任务要求、核验过的本人原话和完整成果。过程仍走原来的分页消息接口。

import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { IdSchema, IsoTimeSchema } from './common.ts';
import { LineViewSchema } from './lines.ts';

const STRICT = { additionalProperties: false };

export const LineSourceViewSchema = Type.Object({
  lineId: IdSchema,
  seq: Type.Integer({ minimum: 1 }),
  text: Type.String(),
}, STRICT);
export type LineSourceView = Static<typeof LineSourceViewSchema>;

export const LineResultViewSchema = Type.Object({
  seq: Type.Integer({ minimum: 1 }),
  text: Type.String(),
  createdAt: IsoTimeSchema,
  complete: Type.Boolean(),
}, STRICT);
export type LineResultView = Static<typeof LineResultViewSchema>;

export const LineDetailsQuerySchema = Type.Object({
  before: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
}, STRICT);
export type LineDetailsQuery = Static<typeof LineDetailsQuerySchema>;

export const LineDetailsResponseSchema = Type.Object({
  line: LineViewSchema,
  request: Nullable(Type.Object({ text: Type.String(), source: Nullable(LineSourceViewSchema) }, STRICT)),
  project: Nullable(Type.Object({ id: IdSchema, title: Type.String() }, STRICT)),
  /** 新的在前；续写的几段是一版，明确返工另成一版。 */
  results: Type.Array(LineResultViewSchema),
  hasMore: Type.Boolean(),
  nextBefore: Nullable(Type.Integer({ minimum: 1 })),
}, STRICT);
export type LineDetailsResponse = Static<typeof LineDetailsResponseSchema>;
