// /v2/agreements: the 约定 column of the memory view (《UI 方案》第 8 节), one agreement with its history and ≠ marks,
// and the user's confirmation — the only way an agreement takes effect or is revoked. Confirming needs a device
// signature (device-keys.ts). A migrated agreement (old guide, decision 82) is already in effect but
// `awaitingConfirmation` until the user confirms or revokes it on a device.

import { Type, type Static } from 'typebox';
import { AGREEMENT_KINDS, AGREEMENT_STATES } from '../state.ts';
import { TermDefinitionSchema, TermDecodingSchema, TermTierSchema } from '../terms.ts';
export { TERM_TIERS, TERM_TIER_LABELS, TermDefinitionSchema } from '../terms.ts';
export type { TermDefinition, TermDecoding } from '../terms.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { ChangeRecordViewSchema, NextOffsetSchema, OrNull, PageLimitSchema, ReasonTextSchema,
  SourceContextSchema } from './lineage.ts';

export const AGREEMENTS_PATH = `${API_PREFIX}/agreements`;

export const AgreementViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(AGREEMENT_KINDS),
  title: OrNull(Type.String()),
  text: Type.String(),
  scope: Type.String(),
  userQuote: OrNull(Type.String()),
  quotedAt: OrNull(IsoTimeSchema),
  perUseConfirmation: Type.Boolean(),
  premises: Type.Array(Type.String()),
  state: Type.Enum(AGREEMENT_STATES),
  proposedDiff: OrNull(Type.String()),
  termTier: Type.Optional(OrNull(TermTierSchema)),
  proposedTerm: Type.Optional(OrNull(TermDefinitionSchema)),
  effectiveAt: OrNull(IsoTimeSchema),
  /** Came over from the old version. */
  migrated: Type.Boolean(),
  /** Migrated and not yet confirmed or revoked on a device: shown as 「迁移来的、待你确认」. */
  awaitingConfirmation: Type.Boolean(),
  confirmedByDeviceAt: OrNull(IsoTimeSchema),
  /** The open ≠ mark on it, if any. */
  openDisagreementId: OrNull(IdSchema),
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type AgreementView = Static<typeof AgreementViewSchema>;

/** GET /v2/agreements?state=&kind=&limit=&offset= — newest first. */
export const AgreementListQuerySchema = Type.Object(
  {
    state: Type.Optional(Type.Enum(AGREEMENT_STATES)),
    kind: Type.Optional(Type.Enum(AGREEMENT_KINDS)),
    limit: Type.Optional(PageLimitSchema),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type AgreementListQuery = Static<typeof AgreementListQuerySchema>;

export const AgreementListResponseSchema = Type.Object({
  agreements: Type.Array(AgreementViewSchema),
  nextOffset: NextOffsetSchema,
});
export type AgreementListResponse = Static<typeof AgreementListResponseSchema>;

/** GET /v2/agreements/:id */
export const AgreementDetailSchema = Type.Object({
  agreement: AgreementViewSchema,
  history: Type.Array(ChangeRecordViewSchema),
  sourceContext: Type.Optional(OrNull(SourceContextSchema)),
});
export type AgreementDetail = Static<typeof AgreementDetailSchema>;

/**
 * POST /v2/agreements/:id/confirm (paired user session) → 200 AgreementResponse.
 * `confirm`: in effect from now (a migrated one keeps its old effective time); `revoke`: 撤.
 * `version` is the one the page showed; a newer one is 409.
 */
export const ConfirmAgreementRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    decision: Type.Enum(['confirm', 'revoke', 'adopt', 'reject']),
    reason: Type.Optional(ReasonTextSchema),
  },
  { additionalProperties: false },
);
export type ConfirmAgreementRequest = Static<typeof ConfirmAgreementRequestSchema>;

export const AgreementResponseSchema = Type.Object({ agreement: AgreementViewSchema });
export type AgreementResponse = Static<typeof AgreementResponseSchema>;

export const CreateTermRequestSchema = Type.Object({
  requestId: RequestIdSchema, kind: Type.Literal('term'), ...TermDefinitionSchema.properties,
}, { additionalProperties: false });
export type CreateTermRequest = Static<typeof CreateTermRequestSchema>;
export const ProposeTermRequestSchema = Type.Object({
  requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), ...TermDefinitionSchema.properties,
}, { additionalProperties: false });
export type ProposeTermRequest = Static<typeof ProposeTermRequestSchema>;
export const TermDecodingListSchema = Type.Object({ decodings: Type.Array(TermDecodingSchema) });
export type TermDecodingList = Static<typeof TermDecodingListSchema>;
