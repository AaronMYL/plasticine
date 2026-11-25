// SPDX-License-Identifier: Apache-2.0

import { Type, type Static, type TSchema } from 'typebox';
import { ACTORS, REASON_KINDS } from '../state-common.ts';
import { SOURCE_KINDS } from '../state-objects.ts';
import { IdSchema, IsoTimeSchema } from './common.ts';

/** A view field that may be null. */
export function OrNull<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

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

export const COGNITION_PAGE_DEFAULT = 50;
export const COGNITION_PAGE_MAX = 200;
export const PageLimitSchema = Type.Integer({ minimum: 1, maximum: COGNITION_PAGE_MAX });
export const NextOffsetSchema = Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]);
/** Why the user made a change, in their words; optional, one or two sentences. */
export const ReasonTextSchema = Type.String({ minLength: 1, maxLength: 500 });
