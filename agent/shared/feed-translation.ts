// 信息流的中文（《优化清单》第 8 条，用户 11-06 定）：外语帖子在抓取时就生成中文译文和中文摘要并存下来，显示时不再翻。
// 用「翻译」那个模型用途（和网页翻译同一个）。短帖直接显示中文全文；长帖显示中文摘要，点「展开」原地展开中文全文，
// 展开后能切到原文。条目里可以嵌一张小图表：只用文章里明写的数字画、注明来源，不编数据；没有就不画。

import { Type, type Static } from 'typebox';

/** 原文多长算长帖（按字计，中文一字一个、英文一个字母一个）：短于这个直接显示全文，长了先给摘要。 */
export const FEED_LONG_TEXT_CHARS = 280;
/** 送去翻的原文最多这么多字：再长只翻前面这些，摘要照样按全文的前面写。 */
export const FEED_TRANSLATE_SOURCE_MAX_CHARS = 12_000;

export const FEED_ZH_STATES = ['pending', 'done', 'skipped', 'failed'] as const;
export type FeedZhState = (typeof FEED_ZH_STATES)[number];

export const FeedChartPointSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 40 }),
  value: Type.Number(),
}, { additionalProperties: false });

/** 一张小图表：一条折线或一组柱子。数字必须在原文里出现过（服务端逐个核对，对不上整张不要）。 */
export const FeedChartSchema = Type.Object({
  kind: Type.Enum(['line', 'bar']),
  /** 图下面那一行：画的是什么（「月销量，近 12 个月」）。 */
  caption: Type.String({ minLength: 1, maxLength: 80 }),
  /** 数据从哪来（「行业协会月报」）；原文没说就写文章的站点名。 */
  source: Type.String({ minLength: 1, maxLength: 80 }),
  unit: Type.Optional(Type.String({ maxLength: 20 })),
  points: Type.Array(FeedChartPointSchema, { minItems: 3, maxItems: 24 }),
}, { additionalProperties: false });
export type FeedChart = Static<typeof FeedChartSchema>;

/** 模型回的样子。lang 是原文语言（BCP-47）；简体中文原文时 title / text 给 null。 */
export const FeedTranslationReplySchema = Type.Object({
  lang: Type.String({ minLength: 2, maxLength: 20 }),
  title: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
  text: Type.Union([Type.String({ maxLength: 40_000 }), Type.Null()]),
  digest: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
  chart: Type.Union([FeedChartSchema, Type.Null()]),
}, { additionalProperties: false });
export type FeedTranslationReply = Static<typeof FeedTranslationReplySchema>;

/** 条目视图里的中文：state 不是 done 时界面照原文显示。 */
export const FeedZhViewSchema = Type.Object({
  state: Type.Enum(FEED_ZH_STATES),
  /** 原文语言；没判出来是 null。 */
  lang: Type.Union([Type.String(), Type.Null()]),
  /** 原文语言的中文叫法（「英文」）；简体中文原文是 null。 */
  from: Type.Union([Type.String(), Type.Null()]),
  title: Type.Union([Type.String(), Type.Null()]),
  text: Type.Union([Type.String(), Type.Null()]),
  digest: Type.Union([Type.String(), Type.Null()]),
});
export type FeedZhView = Static<typeof FeedZhViewSchema>;

export interface FeedTranslationInput {
  title: string;
  text: string;
  site: string | null;
  /** X 的帖子没有标题，正文就是帖子。 */
  post: boolean;
}
export type FeedTranslator = (input: FeedTranslationInput, signal: AbortSignal) => Promise<FeedTranslationReply>;

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: '英文', ja: '日文', ko: '韩文', fr: '法文', de: '德文', es: '西班牙文', ru: '俄文', pt: '葡萄牙文',
  it: '意大利文', 'zh-hant': '繁体中文', 'zh-tw': '繁体中文', 'zh-hk': '繁体中文',
};

/** 简体中文（zh、zh-Hans、zh-CN）不用翻。 */
export function isSimplifiedChinese(lang: string): boolean {
  const lower = lang.toLowerCase();
  return lower === 'zh' || lower === 'zh-hans' || lower === 'zh-cn' || lower === 'zh-sg' || lower === 'cmn';
}

/** 「译自英文」里的那个语言名。没登记的语言写「外文」。 */
export function languageName(lang: string): string {
  const lower = lang.toLowerCase();
  return LANGUAGE_NAMES[lower] ?? LANGUAGE_NAMES[lower.split('-')[0] ?? ''] ?? '外文';
}
