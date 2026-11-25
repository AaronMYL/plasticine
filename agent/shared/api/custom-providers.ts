import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };

export const CUSTOM_PROTOCOLS = ['openai-completions', 'anthropic-messages', 'openai-responses'] as const;
export const CustomProtocolSchema = Type.Enum(CUSTOM_PROTOCOLS);
export type CustomProtocol = Static<typeof CustomProtocolSchema>;
export const CUSTOM_PROTOCOL_LABELS: Readonly<Record<CustomProtocol, string>> = {
  'openai-completions': 'OpenAI 兼容',
  'anthropic-messages': 'Anthropic',
  'openai-responses': 'Responses',
};

export const CUSTOM_PROVIDER_PREFIX = 'custom-';
export const MAX_CUSTOM_MODELS = 200;
export const MAX_TESTED_MODELS = 10;
export const CONTEXT_WINDOW_CHOICES = [32_000, 64_000, 128_000, 200_000, 256_000, 400_000, 1_000_000] as const;
export const DEFAULT_CONTEXT_WINDOW = 128_000;
export const CONNECTION_TEST_TIMEOUT_MS = 20_000;

export const CUSTOM_PROVIDERS_PATH = `${API_PREFIX}/model-providers/custom`;
export const MODEL_CONNECTION_TEST_PATH = `${API_PREFIX}/model-providers/test`;
export const customProviderRemovePath = (providerId: string): string =>
  `${CUSTOM_PROVIDERS_PATH}/${encodeURIComponent(providerId)}/remove`;

const BaseUrlSchema = Type.String({ minLength: 8, maxLength: 500, pattern: '^https?://' });
const ModelIdSchema = Type.String({ minLength: 1, maxLength: 200 });

export const CustomModelSchema = Type.Object({
  id: ModelIdSchema,
  reasoning: Type.Boolean(),
  images: Type.Boolean(),
  contextWindow: Type.Integer({ minimum: 1_000, maximum: 10_000_000 }),
}, STRICT);
export type CustomModel = Static<typeof CustomModelSchema>;

export const CustomProviderInfoSchema = Type.Object({
  baseUrl: Type.String(),
  protocol: CustomProtocolSchema,
}, STRICT);
export type CustomProviderInfo = Static<typeof CustomProviderInfoSchema>;

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

export const TestModelConnectionRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  providerId: Nullable(IdSchema),
  protocol: CustomProtocolSchema,
  baseUrl: BaseUrlSchema,
  apiKey: Type.Optional(Type.String({ maxLength: 4_000 })),
  models: Type.Optional(Type.Array(CustomModelSchema, { maxItems: MAX_TESTED_MODELS })),
}, STRICT);
export type TestModelConnectionRequest = Static<typeof TestModelConnectionRequestSchema>;

export const CONNECTION_TEST_STEPS = ['models', 'reply'] as const;

export const ConnectionTestStepSchema = Type.Object({
  step: Type.Enum(CONNECTION_TEST_STEPS),
  model: Nullable(ModelIdSchema),
  ok: Type.Boolean(),
  summary: Type.String(),
  detail: Nullable(Type.String()),
  status: Nullable(Type.Integer()),
  latencyMs: Type.Integer({ minimum: 0 }),
}, STRICT);
export type ConnectionTestStep = Static<typeof ConnectionTestStepSchema>;

export const TestModelConnectionResponseSchema = Type.Object({
  ok: Type.Boolean(),
  steps: Type.Array(ConnectionTestStepSchema),
  models: Nullable(Type.Array(Type.Object({ id: Type.String(), contextWindow: Nullable(Type.Integer()) }, STRICT))),
}, STRICT);
export type TestModelConnectionResponse = Static<typeof TestModelConnectionResponseSchema>;
