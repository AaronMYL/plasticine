import { Type, type Static } from 'typebox';
import { IdSchema, IsoTimeSchema, Nullable } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });
const Count = Type.Integer({ minimum: 0 });

export const RECEIPT_STATUSES = ['issued', 'succeeded', 'failed', 'unknown', 'dry_run'] as const;
export const ReceiptInputSchema = Type.Object(
  {
    actionId: IdSchema,
    tool: Text,
    argsDigest: Text,
    replay: Type.Enum(['safe', 'once']),
    effect: Type.Enum(['read', 'internal', 'external']),
    taskId: Type.Optional(Nullable(IdSchema)),
    stepKey: Type.Optional(Nullable(Type.String())),
    attempt: Type.Optional(Nullable(Count)),
    runId: Type.Optional(Nullable(IdSchema)),
    receivedAt: Type.Optional(Nullable(IsoTimeSchema)),
  },
  STRICT,
);
export type ReceiptInput = Static<typeof ReceiptInputSchema>;
export const ReceiptPatchSchema = Type.Partial(
  Type.Object(
    {
      status: Type.Enum(RECEIPT_STATUSES),
      attempt: Nullable(Count),
      resultRef: Nullable(Type.String()),
      receivedAt: Nullable(IsoTimeSchema),
      deliveredAt: Nullable(IsoTimeSchema),
      executedAt: Nullable(IsoTimeSchema),
      verifiedAt: Nullable(IsoTimeSchema),
    },
    STRICT,
  ),
  { ...STRICT, minProperties: 1 },
);
export type ReceiptPatch = Static<typeof ReceiptPatchSchema>;
export const ReceiptSchema = Type.Object({
  ...Type.Required(ReceiptInputSchema).properties,
  ...Type.Required(ReceiptPatchSchema).properties,
  createdAt: IsoTimeSchema,
  updatedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type Receipt = Static<typeof ReceiptSchema>;
