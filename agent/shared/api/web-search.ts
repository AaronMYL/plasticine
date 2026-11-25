import { Type, type Static } from 'typebox';
import { Nullable } from '../state-common.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';

const STRICT = { additionalProperties: false };

export const WEB_SEARCH_PATH = `${API_PREFIX}/settings/web-search`;
export const WEB_SEARCH_TEST_PATH = `${WEB_SEARCH_PATH}/test`;

export const WEB_SEARCH_PROVIDERS = ['tavily'] as const;
export const WebSearchProviderSchema = Type.Enum(WEB_SEARCH_PROVIDERS);
export type WebSearchProvider = Static<typeof WebSearchProviderSchema>;
export const WEB_SEARCH_PROVIDER_LABELS: Readonly<Record<WebSearchProvider, string>> = { tavily: 'Tavily' };

export const TAVILY_FREE_MONTHLY = 1000;

export const WebSearchStatusSchema = Type.Object({
  provider: WebSearchProviderSchema,
  configured: Type.Boolean(),
  keyHint: Nullable(Type.String()),
  usedThisMonth: Type.Integer({ minimum: 0 }),
  monthlyFree: Type.Integer({ minimum: 0 }),
  testedAt: Nullable(IsoTimeSchema),
  testOk: Nullable(Type.Boolean()),
}, STRICT);
export type WebSearchStatus = Static<typeof WebSearchStatusSchema>;

export const SaveWebSearchRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  provider: WebSearchProviderSchema,
  apiKey: Nullable(Type.String({ minLength: 8, maxLength: 200 })),
}, STRICT);
export type SaveWebSearchRequest = Static<typeof SaveWebSearchRequestSchema>;

export const TestWebSearchRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type TestWebSearchRequest = Static<typeof TestWebSearchRequestSchema>;

export const WebSearchTestResponseSchema = Type.Object({
  ok: Type.Boolean(),
  error: Nullable(Type.String()),
  status: WebSearchStatusSchema,
}, STRICT);
export type WebSearchTestResponse = Static<typeof WebSearchTestResponseSchema>;
