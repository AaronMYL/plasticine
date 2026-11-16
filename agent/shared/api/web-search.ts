// 网络搜索（11-16 能力总表：Plasticine 原来没有搜索，查资料只能开云端浏览器一页页翻）。接 Tavily（Aaron 弹框选）：
// 搜索和抓网页正文都用它。密钥在设置里填，只写不读：接口只回填没填、末尾几位、这个月用了几次。

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

/** Tavily 免费档每月的次数（他选 Tavily 时看的就是这个数）；设置里写「本月 n / 1000 次」。 */
export const TAVILY_FREE_MONTHLY = 1000;

export const WebSearchStatusSchema = Type.Object({
  provider: WebSearchProviderSchema,
  configured: Type.Boolean(),
  /** 密钥末尾几位（太短不露）；没填是 null。 */
  keyHint: Nullable(Type.String()),
  /** 这个月（服务器时区的自然月）用了几次。 */
  usedThisMonth: Type.Integer({ minimum: 0 }),
  monthlyFree: Type.Integer({ minimum: 0 }),
  /** 上次测过是什么时候、通没通；没测过是 null。 */
  testedAt: Nullable(IsoTimeSchema),
  testOk: Nullable(Type.Boolean()),
}, STRICT);
export type WebSearchStatus = Static<typeof WebSearchStatusSchema>;

/** PUT：填或换密钥；apiKey 为 null 是清掉。 */
export const SaveWebSearchRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  provider: WebSearchProviderSchema,
  apiKey: Nullable(Type.String({ minLength: 8, maxLength: 200 })),
}, STRICT);
export type SaveWebSearchRequest = Static<typeof SaveWebSearchRequestSchema>;

export const TestWebSearchRequestSchema = Type.Object({ requestId: RequestIdSchema }, STRICT);
export type TestWebSearchRequest = Static<typeof TestWebSearchRequestSchema>;

/** 测试：用一次真搜索验证密钥；失败写清是哪一步、为什么（服务端原话）。 */
export const WebSearchTestResponseSchema = Type.Object({
  ok: Type.Boolean(),
  /** 失败时一句话：密钥不对、额度用完、连不上。 */
  error: Nullable(Type.String()),
  status: WebSearchStatusSchema,
}, STRICT);
export type WebSearchTestResponse = Static<typeof WebSearchTestResponseSchema>;
