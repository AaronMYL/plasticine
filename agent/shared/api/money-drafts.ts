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

// 《置信度与做事方式改动方案》第二批：截图直接入账以后的每周汇总（最近 7 天），和一键清掉已记账的原图。
export const MONEY_DRAFT_SUMMARY_PATH = `${MONEY_DRAFTS_PATH}/summary`;
export const MONEY_ORIGINALS_PURGE_PATH = `${MONEY_DRAFTS_PATH}/originals/purge`;
export const MoneyDraftSummarySchema = Type.Object(
  {
    since: Type.String({ format: 'date-time' }),
    /** 这 7 天截图记下的笔数（直接记的和你确认的）。 */
    recorded: Type.Integer({ minimum: 0 }),
    /** 其中还标着「待看」的。 */
    review: Type.Integer({ minimum: 0 }),
    /** 已记账、原图还留着的截图张数（不限这 7 天）。 */
    originals: Type.Integer({ minimum: 0 }),
  },
  STRICT,
);
export type MoneyDraftSummary = Static<typeof MoneyDraftSummarySchema>;
export const PurgeOriginalsRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type PurgeOriginalsRequest = Static<typeof PurgeOriginalsRequestSchema>;
export const PurgeOriginalsResponseSchema = Type.Object({ purged: Type.Integer({ minimum: 0 }) }, STRICT);
export type PurgeOriginalsResponse = Static<typeof PurgeOriginalsResponseSchema>;
