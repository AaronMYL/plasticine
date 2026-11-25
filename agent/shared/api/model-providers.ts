import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IdSchema, RequestIdSchema } from './common.ts';
import { CustomProviderInfoSchema } from './custom-providers.ts';
import { MODEL_PURPOSE_IDS } from './model-purposes.ts';

const STRICT = { additionalProperties: false };

export const MODEL_PROVIDERS_PATH = `${API_PREFIX}/model-providers`;
export const MODEL_DEFAULT_PATH = `${API_PREFIX}/model-default`;
export const MODEL_CONFIG_PATH = `${API_PREFIX}/model-config`;
export const modelProviderPath = (providerId: string): string =>
  `${MODEL_PROVIDERS_PATH}/${encodeURIComponent(providerId)}`;
export const providerLoginPath = (providerId: string, loginId: string): string =>
  `${modelProviderPath(providerId)}/login/${encodeURIComponent(loginId)}`;
export const MODEL_IMAGE_PATH = `${MODEL_PROVIDERS_PATH}/image-model`;

export const PROVIDER_AUTH_METHODS = ['oauth', 'api_key'] as const;
export const ProviderAuthMethodSchema = Type.Enum(PROVIDER_AUTH_METHODS);
export type ProviderAuthMethod = Static<typeof ProviderAuthMethodSchema>;

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ThinkingLevelSchema = Type.Enum(THINKING_LEVELS);
export const THINKING_LABELS: Readonly<Record<(typeof THINKING_LEVELS)[number], string>> = {
  off: '不思考', minimal: '最低', low: '较低', medium: '中等', high: '较高', xhigh: '很高', max: '最高',
};

export const ProviderModelViewSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  contextWindow: Type.Integer({ minimum: 0 }),
  reasoning: Type.Boolean(),
  thinkingLevels: Type.Array(ThinkingLevelSchema),
  input: Type.Array(Type.Enum(['text', 'image'])),
  estimated: Type.Optional(Type.Boolean()),
}, STRICT);

export const ModelProviderViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  methods: Type.Array(ProviderAuthMethodSchema),
  loginLabel: Nullable(Type.String()),
  connected: Nullable(ProviderAuthMethodSchema),
  account: Nullable(Type.String()),
  plan: Nullable(Type.String()),
  keyLast4: Nullable(Type.String({ maxLength: 4 })),
  models: Type.Array(ProviderModelViewSchema),
  enabled: Type.Array(Type.String()),
  custom: Nullable(CustomProviderInfoSchema),
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
  issue: Nullable(Type.String()),
}, STRICT);
export type ModelPurposeView = Static<typeof ModelPurposeViewSchema>;

export const ModelPurposeChangeSchema = Type.Object({
  purpose: Type.Enum(MODEL_PURPOSE_IDS),
  chosen: ModelOverrideSchema,
}, STRICT);

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
  chosen: Nullable(ModelChoiceViewSchema),
  effective: Nullable(ModelChoiceViewSchema),
  version: Type.Integer({ minimum: 0 }),
  purposes: Type.Array(ModelPurposeViewSchema),
  defaultIssue: Nullable(Type.String()),
}, STRICT);
export type ListModelProvidersResponse = Static<typeof ListModelProvidersResponseSchema>;

export const LOGIN_STATUSES = ['waiting', 'done', 'failed', 'cancelled'] as const;

export const ProviderLoginViewSchema = Type.Object({
  id: IdSchema,
  providerId: IdSchema,
  status: Type.Enum(LOGIN_STATUSES),
  url: Nullable(Type.String()),
  instructions: Nullable(Type.String()),
  deviceCode: Nullable(Type.Object({ userCode: Type.String(), verificationUri: Type.String() }, STRICT)),
  prompt: Nullable(Type.Object({ type: Type.String(), message: Type.String(),
    placeholder: Nullable(Type.String()) }, STRICT)),
  progress: Nullable(Type.String()),
  error: Nullable(Type.String()),
}, STRICT);
export type ProviderLoginView = Static<typeof ProviderLoginViewSchema>;

/** POST /v2/model-providers/:id/login */
export const StartProviderLoginRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);

export const CompleteProviderLoginRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  input: Type.String({ minLength: 1, maxLength: 8_000 }),
}, STRICT);

/** POST /v2/model-providers/:id/key */
export const SetProviderKeyRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  apiKey: Type.String({ minLength: 1, maxLength: 4_000 }),
}, STRICT);

export const ProviderCommandRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);

/** POST /v2/model-default */
export const SetDefaultModelRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  provider: IdSchema,
  model: Type.String({ minLength: 1 }),
  thinking: Type.Optional(ThinkingLevelSchema),
}, STRICT);
export type SetDefaultModelRequest = Static<typeof SetDefaultModelRequestSchema>;

export const ImageModelResponseSchema = Type.Object({
  model: Nullable(Type.String({ minLength: 1, maxLength: 80 })),
}, STRICT);
export type ImageModelResponse = Static<typeof ImageModelResponseSchema>;
