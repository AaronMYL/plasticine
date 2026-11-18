// 设置 · AI 最上面的「用量」（11-18 Aaron：「再在设置-AI 中增加一个AI用量统计」；设计稿弹框选「照做，但放 AI 页最上面」）。
// 今天 / 7 天 / 30 天：请求次数、输入（含缓存读写）、输出、估算费用（按各模型的 API 价，订阅登录的实际不按这个收），
// 每天（今天按小时）一根柱子，按模型、按用途分开看。线上的请求从线的记录里来，旁路调用（笔记、记忆整理这些）从
// model_calls（迁移 0150）来。时间按请求带的时区分天。

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
  /** 他设备的时区（IANA）；不给用设置里的。 */
  tz: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
}, STRICT);
export type ModelUsageQuery = Static<typeof ModelUsageQuerySchema>;

const Count = Type.Integer({ minimum: 0 });
const Money = Type.Number({ minimum: 0 });

/** 一段时间里加起来的量。input 是发给模型的全部（含缓存读写），cacheRead 是其中命中缓存的。 */
export const UsageAmountSchema = Type.Object({
  requests: Count,
  input: Count,
  cacheRead: Count,
  output: Count,
  /** 按 API 价估的美元；有一次没有价格（自定义提供商）就只算有价格的那些。 */
  cost: Money,
  /** 这些请求里有没有带价格的：一次都没有时界面写「没有价格」。 */
  priced: Type.Boolean(),
}, STRICT);
export type UsageAmount = Static<typeof UsageAmountSchema>;

/** 柱子：今天是一小时一根（label「09」），7 天、30 天是一天一根（label「11-18」）。 */
export const UsageBucketSchema = Type.Object({
  label: Type.String(),
  start: Type.String(),
  amount: UsageAmountSchema,
}, STRICT);
export type UsageBucket = Static<typeof UsageBucketSchema>;

/** 按模型或按用途的一行：name 是给人看的名字；provider 只在按模型时有；lines 只在按线算的用途（主线、队友、后台线）有。 */
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
