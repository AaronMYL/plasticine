import { Type, type Static } from 'typebox';

export const FEED_LONG_TEXT_CHARS = 280;
export const FEED_TRANSLATE_SOURCE_MAX_CHARS = 12_000;

export const FEED_ZH_STATES = ['pending', 'done', 'skipped', 'failed'] as const;
export type FeedZhState = (typeof FEED_ZH_STATES)[number];

export const FeedChartPointSchema = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 40 }),
  value: Type.Number(),
}, { additionalProperties: false });

export const FeedChartSchema = Type.Object({
  kind: Type.Enum(['line', 'bar']),
  caption: Type.String({ minLength: 1, maxLength: 80 }),
  source: Type.String({ minLength: 1, maxLength: 80 }),
  unit: Type.Optional(Type.String({ maxLength: 20 })),
  points: Type.Array(FeedChartPointSchema, { minItems: 3, maxItems: 24 }),
}, { additionalProperties: false });
export type FeedChart = Static<typeof FeedChartSchema>;

export const FeedTranslationReplySchema = Type.Object({
  lang: Type.String({ minLength: 2, maxLength: 20 }),
  title: Type.Union([Type.String({ maxLength: 1_000 }), Type.Null()]),
  text: Type.Union([Type.String({ maxLength: 40_000 }), Type.Null()]),
  digest: Type.Union([Type.String({ maxLength: 2_000 }), Type.Null()]),
  chart: Type.Union([FeedChartSchema, Type.Null()]),
}, { additionalProperties: false });
export type FeedTranslationReply = Static<typeof FeedTranslationReplySchema>;

export const FeedZhViewSchema = Type.Object({
  state: Type.Enum(FEED_ZH_STATES),
  lang: Type.Union([Type.String(), Type.Null()]),
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
  post: boolean;
}
export type FeedTranslator = (input: FeedTranslationInput, signal: AbortSignal) => Promise<FeedTranslationReply>;

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: '英文', ja: '日文', ko: '韩文', fr: '法文', de: '德文', es: '西班牙文', ru: '俄文', pt: '葡萄牙文',
  it: '意大利文', 'zh-hant': '繁体中文', 'zh-tw': '繁体中文', 'zh-hk': '繁体中文',
};

export function isSimplifiedChinese(lang: string): boolean {
  const lower = lang.toLowerCase();
  return lower === 'zh' || lower === 'zh-hans' || lower === 'zh-cn' || lower === 'zh-sg' || lower === 'cmn';
}

export function languageName(lang: string): string {
  const lower = lang.toLowerCase();
  return LANGUAGE_NAMES[lower] ?? LANGUAGE_NAMES[lower.split('-')[0] ?? ''] ?? '外文';
}
