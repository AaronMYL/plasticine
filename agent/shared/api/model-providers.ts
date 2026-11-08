// 新内核的模型连接（2026-11-05 他定：提供商一律平级）。ChatGPT、Claude、智谱、DeepSeek、Kimi、通义千问、MiniMax……
// 都是 pi-ai 提供商列表里的一项，各自用该家支持的方式连接：有订阅登录的走登录（OAuth），都能填 key。接口全按
// provider id 通用，没有哪家专用的路径。密钥只写不读：列表里只说连没连、用哪种方式连的。

import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';
import { MODEL_PURPOSE_IDS } from './model-purposes.ts';

const STRICT = { additionalProperties: false };

export const MODEL_PROVIDERS_PATH = `${API_PREFIX}/model-providers`;
export const MODEL_DEFAULT_PATH = `${API_PREFIX}/model-default`;
export const MODEL_CONFIG_PATH = `${API_PREFIX}/model-config`;
export const modelProviderPath = (providerId: string): string =>
  `${MODEL_PROVIDERS_PATH}/${encodeURIComponent(providerId)}`;
export const providerLoginPath = (providerId: string, loginId: string): string =>
  `${modelProviderPath(providerId)}/login/${encodeURIComponent(loginId)}`;

export const PROVIDER_AUTH_METHODS = ['oauth', 'api_key'] as const;
export const ProviderAuthMethodSchema = Type.Enum(PROVIDER_AUTH_METHODS);
export type ProviderAuthMethod = Static<typeof ProviderAuthMethodSchema>;

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ThinkingLevelSchema = Type.Enum(THINKING_LEVELS);
export const THINKING_LABELS: Readonly<Record<(typeof THINKING_LEVELS)[number], string>> = {
  off: '关闭', minimal: '最低', low: '较低', medium: '中等', high: '较高', xhigh: '很高', max: '最高',
};

export const ProviderModelViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  contextWindow: Type.Integer({ minimum: 0 }),
  reasoning: Type.Boolean(),
  thinkingLevels: Type.Array(ThinkingLevelSchema),
  input: Type.Array(Type.Enum(['text', 'image'])),
}, STRICT);

export const ModelProviderViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  /** 这家支持的连接方式：oauth（订阅登录）、api_key（填 key）。 */
  methods: Type.Array(ProviderAuthMethodSchema),
  /** 订阅登录那个按钮上的字（pi-ai 给的，例如「Sign in with ChatGPT」）。 */
  loginLabel: Nullable(Type.String()),
  /** 现在连着没有、用哪种方式连的；没连是 null。 */
  connected: Nullable(ProviderAuthMethodSchema),
  /** 订阅登录的账号（令牌里带的邮箱）和套餐；看不出来是 null。 */
  account: Nullable(Type.String()),
  plan: Nullable(Type.String()),
  /** 填的 key 的最后 4 位（认得出是哪把，密钥本身不回显）；不是 key 连的是 null。 */
  keyLast4: Nullable(Type.String({ maxLength: 4 })),
  models: Type.Array(ProviderModelViewSchema),
  /** 这家启用了哪几个模型（模型 id，照 models 的顺序）；没启用的不出现在任何选择器里。 */
  enabled: Type.Array(Type.String()),
}, STRICT);
export type ModelProviderView = Static<typeof ModelProviderViewSchema>;

export const ModelChoiceViewSchema = Type.Object({
  provider: IdSchema,
  model: Type.String({ minLength: 1 }),
  thinking: ThinkingLevelSchema,
}, STRICT);
export type ModelChoiceView = Static<typeof ModelChoiceViewSchema>;

export const ModelOverrideSchema = Type.Object({
  model: Nullable(Type.Object({ provider: IdSchema, model: Type.String({ minLength: 1 }) }, STRICT)),
  thinking: Nullable(ThinkingLevelSchema),
}, STRICT);
export type ModelOverride = Static<typeof ModelOverrideSchema>;

export const ModelPurposeViewSchema = Type.Object({
  purpose: Type.Enum(MODEL_PURPOSE_IDS),
  chosen: ModelOverrideSchema,
  effective: Nullable(ModelChoiceViewSchema),
  /** 配置未改写；不可用模型或不支持的思考档的实际适配在这里说明。 */
  issue: Nullable(Type.String()),
}, STRICT);
export type ModelPurposeView = Static<typeof ModelPurposeViewSchema>;

export const ModelPurposeChangeSchema = Type.Object({
  purpose: Type.Enum(MODEL_PURPOSE_IDS),
  chosen: ModelOverrideSchema,
}, STRICT);

/** 一家启用哪几个模型：整份换掉。 */
export const ModelEnabledChangeSchema = Type.Object({
  provider: IdSchema,
  models: Type.Array(Type.String({ minLength: 1 }), { maxItems: 2_000 }),
}, STRICT);
export type ModelEnabledChange = Static<typeof ModelEnabledChangeSchema>;

export const SaveModelConfigRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 0 }),
  default: Type.Optional(Nullable(ModelChoiceViewSchema)),
  purposes: Type.Array(ModelPurposeChangeSchema, { maxItems: MODEL_PURPOSE_IDS.length }),
  enabled: Type.Optional(Type.Array(ModelEnabledChangeSchema, { maxItems: 200 })),
}, STRICT);
export type SaveModelConfigRequest = Static<typeof SaveModelConfigRequestSchema>;

/** GET /v2/model-providers */
export const ListModelProvidersResponseSchema = Type.Object({
  providers: Type.Array(ModelProviderViewSchema),
  /** 他选的默认模型；没选过是 null。 */
  chosen: Nullable(ModelChoiceViewSchema),
  /** 全局默认的实际解析；各用途的生效配置在 purposes。一家都没连是 null。 */
  effective: Nullable(ModelChoiceViewSchema),
  version: Type.Integer({ minimum: 0 }),
  purposes: Type.Array(ModelPurposeViewSchema),
  defaultIssue: Nullable(Type.String()),
}, STRICT);
export type ListModelProvidersResponse = Static<typeof ListModelProvidersResponseSchema>;

export const LOGIN_STATUSES = ['waiting', 'done', 'failed', 'cancelled'] as const;

/** 一次订阅登录走到哪了：打开授权网址、输设备码、把浏览器跳转到的回调地址交上来……都是同一个形状。 */
export const ProviderLoginViewSchema = Type.Object({
  id: IdSchema,
  providerId: IdSchema,
  status: Type.Enum(LOGIN_STATUSES),
  /** 去这里授权（客户端或 Mac App 打开它）。 */
  url: Nullable(Type.String()),
  instructions: Nullable(Type.String()),
  deviceCode: Nullable(Type.Object({ userCode: Type.String(), verificationUri: Type.String() }, STRICT)),
  /** 登录在等他交一样东西（回调地址、代码……）；交到 complete。 */
  prompt: Nullable(Type.Object({ type: Type.String(), message: Type.String(),
    placeholder: Nullable(Type.String()) }, STRICT)),
  progress: Nullable(Type.String()),
  error: Nullable(Type.String()),
}, STRICT);
export type ProviderLoginView = Static<typeof ProviderLoginViewSchema>;

/** POST /v2/model-providers/:id/login */
export const StartProviderLoginRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);

/** POST /v2/model-providers/:id/login/:loginId/complete：交回调地址（或该家要的代码）。 */
export const CompleteProviderLoginRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  input: Type.String({ minLength: 1, maxLength: 8_000 }),
}, STRICT);

/** POST /v2/model-providers/:id/key */
export const SetProviderKeyRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  apiKey: Type.String({ minLength: 1, maxLength: 4_000 }),
}, STRICT);

/** POST /v2/model-providers/:id/logout、…/login/:loginId/cancel */
export const ProviderCommandRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);

/** POST /v2/model-default */
export const SetDefaultModelRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  provider: IdSchema,
  model: Type.String({ minLength: 1 }),
  thinking: Type.Optional(ThinkingLevelSchema),
}, STRICT);
export type SetDefaultModelRequest = Static<typeof SetDefaultModelRequestSchema>;
