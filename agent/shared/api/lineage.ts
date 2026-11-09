// SPDX-License-Identifier: Apache-2.0
// Pieces the memory, judgment and agreement views share: a source with its w, and one line of an object's history
// (判断的「来路」、记忆条目的「用户编辑记录」，《从零方案》第 4 节).

import { Type, type Static, type TSchema } from 'typebox';
// 直接从分组文件取（不经 ../state.ts 汇总）：shared/state-network.ts 用到 api/contacts.ts，经汇总会绕成一个环。
import { ACTORS, REASON_KINDS } from '../state-common.ts';
import { SOURCE_KINDS } from '../state-objects.ts';
import { IdSchema, IsoTimeSchema } from './common.ts';

/** A view field that may be null. */
export function OrNull<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

/** w only says where something came from (第 19 条): never a truth value, never a permission. */
export const SourceViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(SOURCE_KINDS),
  label: Type.String(),
  w: Type.Number(),
  ref: Type.Optional(OrNull(Type.String())),
});
export type SourceView = Static<typeof SourceViewSchema>;

export const ChangeRecordViewSchema = Type.Object({
  version: Type.Integer({ minimum: 1 }),
  actor: Type.Enum(ACTORS),
  deviceName: Type.Optional(OrNull(Type.String())),
  reason: Type.String(),
  reasonKind: Type.Union([Type.Enum(REASON_KINDS), Type.Null()]),
  fields: Type.Array(Type.String()),
  /** 「是否伴随验证程度变化」：the change touched the verification column. */
  verificationChanged: Type.Boolean(),
  /** Written with a device signature (a user-confirmed field). */
  confirmedByDevice: Type.Boolean(),
  at: IsoTimeSchema,
});
export type ChangeRecordView = Static<typeof ChangeRecordViewSchema>;

export const SourceContextSchema = Type.Object({
  kind: Type.Enum(['message', 'note', 'quote']), ref: Type.String(), text: Type.String(),
  chatId: OrNull(Type.String()), at: OrNull(IsoTimeSchema),
});
export type SourceContext = Static<typeof SourceContextSchema>;

// Lists in the memory view and on the judgment page: 50 a page like the conversation (《实施方案》第 5 节).
export const COGNITION_PAGE_DEFAULT = 50;
export const COGNITION_PAGE_MAX = 200;
export const PageLimitSchema = Type.Integer({ minimum: 1, maximum: COGNITION_PAGE_MAX });
export const NextOffsetSchema = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
/** Why the user made a change, in their words; optional, one or two sentences. */
export const ReasonTextSchema = Type.String({ minLength: 1, maxLength: 500 });
