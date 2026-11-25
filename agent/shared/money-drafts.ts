import { Type, type Static } from 'typebox';
import { CentsSchema, CurrencySchema } from './state-life.ts';

const Nullable = <T extends import('typebox').TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Id = Type.String({ minLength: 1 });
const Time = Type.String({ format: 'date-time' });
export const PaymentFieldsSchema = Type.Object(
  {
    amountCents: CentsSchema,
    currency: CurrencySchema,
    merchant: Nullable(Type.String({ maxLength: 200 })),
    occurredAt: Time,
    kind: Type.Enum(['expense', 'income', 'refund']),
    accountId: Nullable(Id),
    categoryId: Nullable(Id),
  },
  { additionalProperties: false },
);
export type PaymentFields = Static<typeof PaymentFieldsSchema>;
export const PaymentCandidateSchema = Type.Object(
  {
    ...PaymentFieldsSchema.properties,
    amountCents: Nullable(CentsSchema),
    currency: Nullable(CurrencySchema),
    occurredAt: Nullable(Time),
    kind: Nullable(Type.Enum(['expense', 'income', 'refund'])),
    basis: Type.String({ maxLength: 1000 }),
    uncertainty: Type.String({ maxLength: 1000 }),
  },
  { additionalProperties: false },
);
export type PaymentCandidate = Static<typeof PaymentCandidateSchema>;
export const EMPTY_PAYMENT_CANDIDATE: PaymentCandidate = {
  amountCents: null,
  currency: null,
  merchant: null,
  occurredAt: null,
  kind: null,
  accountId: null,
  categoryId: null,
  basis: '',
  uncertainty: '',
};
export const MoneyDraftSchema = Type.Object({
  id: Id,
  version: Type.Integer({ minimum: 1 }),
  requestId: Id,
  attachmentId: Id,
  messageId: Nullable(Id),
  status: Type.Enum(['reading', 'ready', 'failed', 'confirmed', 'rejected']),
  candidate: PaymentCandidateSchema,
  askId: Nullable(Id),
  runId: Nullable(Id),
  entryId: Nullable(Id),
  duplicateEntryId: Nullable(Id),
  error: Nullable(Type.String()),
  confirmedByDeviceId: Nullable(Id),
  createdAt: Time,
  updatedAt: Time,
});
export type MoneyDraft = Static<typeof MoneyDraftSchema>;
