// 自定义模型提供商（11-16 Aaron：「Plasticine AI 调用增加自定义调用」）：自己填接口地址、API Key、模型名和接口协议，
// 和内置的几十家平级；测试连接验证配置能不能用，失败时写清是哪一步、为什么。
// 配置存在实际执行任务的那一端（kernel_settings），key 和别家一样只写不读。

import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };

/** 接口协议：OpenAI 兼容（Chat Completions）、Anthropic 兼容（Messages）、OpenAI Responses。 */
export const CUSTOM_PROTOCOLS = ['openai-completions', 'anthropic-messages', 'openai-responses'] as const;
export const CustomProtocolSchema = Type.Enum(CUSTOM_PROTOCOLS);
export type CustomProtocol = Static<typeof CustomProtocolSchema>;
export const CUSTOM_PROTOCOL_LABELS: Readonly<Record<CustomProtocol, string>> = {
  'openai-completions': 'OpenAI 兼容',
  'anthropic-messages': 'Anthropic',
  'openai-responses': 'Responses',
};

/** 自定义提供商的 id 都以它开头，免得和内置的撞。 */
export const CUSTOM_PROVIDER_PREFIX = 'custom-';
export const MAX_CUSTOM_MODELS = 200;
/** 测试连接一次最多试几个模型（同时发）。 */
export const MAX_TESTED_MODELS = 10;
/** 上下文长度能选的几档（token）；不知道就用默认那档。 */
export const CONTEXT_WINDOW_CHOICES = [32_000, 64_000, 128_000, 200_000, 256_000, 400_000, 1_000_000] as const;
export const DEFAULT_CONTEXT_WINDOW = 128_000;
/** 测试连接每一步最多等这么久（读模型列表、让模型回一句各一次）。 */
export const CONNECTION_TEST_TIMEOUT_MS = 20_000;

export const CUSTOM_PROVIDERS_PATH = `${API_PREFIX}/model-providers/custom`;
export const MODEL_CONNECTION_TEST_PATH = `${API_PREFIX}/model-providers/test`;
export const customProviderRemovePath = (providerId: string): string =>
  `${CUSTOM_PROVIDERS_PATH}/${encodeURIComponent(providerId)}/remove`;

const BaseUrlSchema = Type.String({ minLength: 8, maxLength: 500, pattern: '^https?://' });
const ModelIdSchema = Type.String({ minLength: 1, maxLength: 200 });

/**
 * 一个模型自己的几样（11-16 Aaron：要思考档、上下文、是否支持图片）：接口不会说，由他在表单里标。
 * reasoning：能思考（各处能选 不思考 / 较低 / 中等 / 较高）；images：能看图；contextWindow：上下文多长。
 */
export const CustomModelSchema = Type.Object({
  id: ModelIdSchema,
  reasoning: Type.Boolean(),
  images: Type.Boolean(),
  contextWindow: Type.Integer({ minimum: 1_000, maximum: 10_000_000 }),
}, STRICT);
export type CustomModel = Static<typeof CustomModelSchema>;

/** 列表里自定义那几家多带的：地址和协议（编辑时回填；key 不回显）。内置的是 null。 */
export const CustomProviderInfoSchema = Type.Object({
  baseUrl: Type.String(),
  protocol: CustomProtocolSchema,
}, STRICT);
export type CustomProviderInfo = Static<typeof CustomProviderInfoSchema>;

/** POST /v2/model-providers/custom：id 是 null 就新建，否则改那一家；apiKey 不给就沿用存着的。 */
export const SaveCustomProviderRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  id: Nullable(IdSchema),
  name: Type.String({ minLength: 1, maxLength: 40 }),
  protocol: CustomProtocolSchema,
  baseUrl: BaseUrlSchema,
  apiKey: Type.Optional(Type.String({ maxLength: 4_000 })),
  models: Type.Array(CustomModelSchema, { minItems: 1, maxItems: MAX_CUSTOM_MODELS }),
}, STRICT);
export type SaveCustomProviderRequest = Static<typeof SaveCustomProviderRequestSchema>;

/** POST /v2/model-providers/custom/:id/remove */
export const RemoveCustomProviderRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);

/**
 * POST /v2/model-providers/test：用表单里还没保存的配置试一次。providerId 是已存的那家时，apiKey 不给就用存着的 key；
 * models 不给就只查模型列表；给了每个都让它回一句（标了能思考的带「较低」思考，能看图的带一张小图）。
 */
export const TestModelConnectionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  providerId: Nullable(IdSchema),
  protocol: CustomProtocolSchema,
  baseUrl: BaseUrlSchema,
  apiKey: Type.Optional(Type.String({ maxLength: 4_000 })),
  models: Type.Optional(Type.Array(CustomModelSchema, { maxItems: MAX_TESTED_MODELS })),
}, STRICT);
export type TestModelConnectionRequest = Static<typeof TestModelConnectionRequestSchema>;

/** 哪一步：读模型列表、让模型回一句。 */
export const CONNECTION_TEST_STEPS = ['models', 'reply'] as const;

export const ConnectionTestStepSchema = Type.Object({
  step: Type.Enum(CONNECTION_TEST_STEPS),
  /** reply 那一步试的是哪个模型；models 那一步是 null。 */
  model: Nullable(ModelIdSchema),
  ok: Type.Boolean(),
  /** 一句结论：「API Key 不对（401）」「monk 回复了」。 */
  summary: Type.String(),
  /** 服务端原样回的错误（截短），给 ⓘ 里看。 */
  detail: Nullable(Type.String()),
  status: Nullable(Type.Integer()),
  latencyMs: Type.Integer({ minimum: 0 }),
}, STRICT);
export type ConnectionTestStep = Static<typeof ConnectionTestStepSchema>;

export const TestModelConnectionResponseSchema = Type.Object({
  ok: Type.Boolean(),
  steps: Type.Array(ConnectionTestStepSchema),
  /** 接口列出的模型（带得出上下文长度的一起给）；没列出来是 null。 */
  models: Nullable(Type.Array(Type.Object({ id: Type.String(), contextWindow: Nullable(Type.Integer()) }, STRICT))),
}, STRICT);
export type TestModelConnectionResponse = Static<typeof TestModelConnectionResponseSchema>;
