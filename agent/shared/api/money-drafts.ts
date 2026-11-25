import { Type, type Static } from 'typebox';
import { MoneyDraftSchema, PaymentCandidateSchema, PaymentFieldsSchema } from '../money-drafts.ts';
import { RequestIdSchema, IdSchema } from './common.ts';
export * from '../money-drafts.ts';

const STRICT = { additionalProperties: false };
export const MONEY_DRAFTS_PATH = '/v2/money/drafts';
export const MoneyDraftViewSchema = Type.Object({
  ...MoneyDraftSchema.properties,
  askVersion: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type MoneyDraftView = Static<typeof MoneyDraftViewSchema>;
export const CreateMoneyDraftRequestSchema = Type.Object(
  { requestId: RequestIdSchema, attachmentId: IdSchema, messageId: Type.Union([IdSchema, Type.Null()]) },
  STRICT,
);
export type CreateMoneyDraftRequest = Static<typeof CreateMoneyDraftRequestSchema>;
export const EditMoneyDraftRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), candidate: PaymentCandidateSchema },
  STRICT,
);
export type EditMoneyDraftRequest = Static<typeof EditMoneyDraftRequestSchema>;
export const ConfirmMoneyDraftRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    askVersion: Type.Integer({ minimum: 1 }),
    fields: PaymentFieldsSchema,
  },
  STRICT,
);
export type ConfirmMoneyDraftRequest = Static<typeof ConfirmMoneyDraftRequestSchema>;
export const RejectMoneyDraftRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), askVersion: Type.Integer({ minimum: 1 }) },
  STRICT,
);
export type RejectMoneyDraftRequest = Static<typeof RejectMoneyDraftRequestSchema>;

export const MONEY_DRAFT_SUMMARY_PATH = `${MONEY_DRAFTS_PATH}/summary`;
export const MONEY_ORIGINALS_PURGE_PATH = `${MONEY_DRAFTS_PATH}/originals/purge`;
export const MoneyDraftSummarySchema = Type.Object(
  {
    since: Type.String({ format: 'date-time' }),
    recorded: Type.Integer({ minimum: 0 }),
    review: Type.Integer({ minimum: 0 }),
    originals: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type MoneyDraftSummary = Static<typeof MoneyDraftSummarySchema>;
export const PurgeOriginalsRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type PurgeOriginalsRequest = Static<typeof PurgeOriginalsRequestSchema>;
export const PurgeOriginalsResponseSchema = Type.Object({ purged: Type.Integer({ minimum: 0 }) }, STRICT);
export type PurgeOriginalsResponse = Static<typeof PurgeOriginalsResponseSchema>;
