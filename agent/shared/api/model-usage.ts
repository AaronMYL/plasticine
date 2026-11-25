import { Type, type Static } from 'typebox';
import { MODEL_PROVIDERS_PATH } from './model-providers.ts';

const STRICT = { additionalProperties: false };

export const MODEL_USAGE_PATH = `${MODEL_PROVIDERS_PATH}/usage`;

export const USAGE_RANGES = ['today', 'week', 'month'] as const;
export const UsageRangeSchema = Type.Enum(USAGE_RANGES);
export type UsageRange = Static<typeof UsageRangeSchema>;
export const USAGE_RANGE_LABELS: Readonly<Record<UsageRange, string>> = { today: '今天', week: '7 天', month: '30 天' };

export const ModelUsageQuerySchema = Type.Object({
  range: Type.Optional(UsageRangeSchema),
  tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, STRICT);
export type ModelUsageQuery = Static<typeof ModelUsageQuerySchema>;

const Count = Type.Integer({ minimum: 0 });
const Money = Type.Number({ minimum: 0 });

export const UsageAmountSchema = Type.Object({
  requests: Count,
  input: Count,
  cacheRead: Count,
  output: Count,
  cost: Money,
  priced: Type.Boolean(),
}, STRICT);
export type UsageAmount = Static<typeof UsageAmountSchema>;

export const UsageBucketSchema = Type.Object({
  label: Type.String(),
  start: Type.String(),
  amount: UsageAmountSchema,
}, STRICT);
export type UsageBucket = Static<typeof UsageBucketSchema>;

export const UsageGroupSchema = Type.Object({
  key: Type.String(),
  name: Type.String(),
  provider: Type.Optional(Type.String()),
  lines: Type.Optional(Count),
  amount: UsageAmountSchema,
}, STRICT);
export type UsageGroup = Static<typeof UsageGroupSchema>;

export const ModelUsageReportSchema = Type.Object({
  range: UsageRangeSchema,
  timeZone: Type.String(),
  total: UsageAmountSchema,
  buckets: Type.Array(UsageBucketSchema),
  byModel: Type.Array(UsageGroupSchema),
  byPurpose: Type.Array(UsageGroupSchema),
}, STRICT);
export type ModelUsageReport = Static<typeof ModelUsageReportSchema>;
