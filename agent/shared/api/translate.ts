// 沉浸式翻译（2026-11-03 第 2 批，用户定「点了才翻 · 双语对照」）：网页标签里的段落经原生桥交给网页界面，网页界面
// 调 POST /v2/translate 拿译文，再经桥送回原生注入。服务器按（原文散列、目标语言、模型、用到的词）缓存，同一页再开不再
// 花额度；只发段落文字，不发输入框里填的内容（切段在 client/src/mac/translate-page.ts）。
// 设置：翻译用哪个模型单独一份（2026-11-05 跟新内核的模型连接走，/v2/translate/model；不选就用默认模型、低推理）；翻译成、
// 显示方式、用词表、总是翻译的网站存在库里（/v2/translate/settings，迁移 0046）。

import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { ModelChoiceViewSchema } from './model-providers.ts';
import { Nullable } from '../state-common.ts';

export const TRANSLATE_PATH = `${API_PREFIX}/translate`;
export const TRANSLATE_SETTINGS_PATH = `${API_PREFIX}/translate/settings`;
export const TRANSLATE_MODEL_PATH = `${API_PREFIX}/translate/model`;

/** GET /v2/translate/model：他给翻译选的模型（null = 跟默认模型走、低推理）和实际会用的那个。 */
export const TranslateModelViewSchema = Type.Object({
  chosen: Nullable(ModelChoiceViewSchema),
  /** 实际会用的：选的那家没连上时退到默认模型；一家都没连是 null。 */
  effective: Nullable(ModelChoiceViewSchema),
  version: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type TranslateModelView = Static<typeof TranslateModelViewSchema>;

/** PUT /v2/translate/model：换一个（chosen null = 回到跟默认模型走）；version 是读到的那一版，旧了 409。 */
export const SetTranslateModelRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 0 }),
  chosen: Nullable(ModelChoiceViewSchema),
}, { additionalProperties: false });
export type SetTranslateModelRequest = Static<typeof SetTranslateModelRequestSchema>;

const STRICT = { additionalProperties: false };

/** 翻译成：常用的几种；第一项是默认。 */
export const TRANSLATE_TARGETS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es'] as const;
export type TranslateTarget = (typeof TRANSLATE_TARGETS)[number];
export const TranslateTargetSchema = Type.Enum(TRANSLATE_TARGETS);

/** 界面上的名字：用那种语言自己的写法，中文写「中文」。 */
export const TRANSLATE_TARGET_LABELS: Readonly<Record<TranslateTarget, string>> = {
  'zh-CN': '中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
};

/** 给模型的名字（提示里用）。 */
export const TRANSLATE_TARGET_PROMPT: Readonly<Record<TranslateTarget, string>> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁体中文（台湾用语）',
  en: '英语',
  ja: '日语',
  ko: '韩语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
};

/** 双语对照：原文下面插一段译文；只看译文：原文藏起，悬停看原文。 */
export const TRANSLATE_DISPLAYS = ['bilingual', 'translation'] as const;
export type TranslateDisplay = (typeof TRANSLATE_DISPLAYS)[number];
export const TranslateDisplaySchema = Type.Enum(TRANSLATE_DISPLAYS);

// 总是翻译的网站最多这么多个：再多是该换成「全部外文网页都翻」的开关了，不是一个一个记。
export const TRANSLATE_SITES_MAX = 200;
const SiteSchema = Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9.-]+$' });

export const TranslateSettingsViewSchema = Type.Object({
  /** 0 是还没改过（全是默认值）。 */
  version: Type.Integer({ minimum: 0 }),
  target: TranslateTargetSchema,
  display: TranslateDisplaySchema,
  /** 开着时他的用词按记忆里的词表译。 */
  glossary: Type.Boolean(),
  alwaysSites: Type.Array(SiteSchema, { maxItems: TRANSLATE_SITES_MAX }),
}, STRICT);
export type TranslateSettingsView = Static<typeof TranslateSettingsViewSchema>;

/** PUT /v2/translate/settings：带上读到的 version，对不上就 409，不覆盖。 */
export const SetTranslateSettingsSchema = TranslateSettingsViewSchema;
export type SetTranslateSettings = Static<typeof SetTranslateSettingsSchema>;

export const DEFAULT_TRANSLATE_SETTINGS: Omit<TranslateSettingsView, 'version'> = {
  target: 'zh-CN',
  display: 'bilingual',
  glossary: true,
  alwaysSites: [],
};

// 一批的上限：网页那边按视口切成一批一批送，一批不超过这些；单段再长的（整页一个 div）不译。
export const TRANSLATE_BATCH_MAX_ITEMS = 24;
export const TRANSLATE_ITEM_MAX_CHARS = 4_000;
export const TRANSLATE_BATCH_MAX_CHARS = 12_000;
/**
 * 服务端一批最多等模型这么久（一批最多 12 000 字，轻量模型通常十几秒内回），从排到并发位开始算。
 * 两端共用这一份：客户端一批的请求时限必须比它长，不然客户端先断开、服务端跟着中止，译好的也进不了缓存。
 */
export const TRANSLATE_MODEL_TIMEOUT_MS = 60_000;
const SegmentIdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_:.-]+$' });

/** 视口里正看着的段落先译，往下一屏的预取排在后面。 */
export const TRANSLATE_PRIORITIES = ['visible', 'ahead'] as const;
export type TranslatePriority = (typeof TRANSLATE_PRIORITIES)[number];

export const TranslateRequestSchema = Type.Object({
  pageUrl: Type.String({ minLength: 1, maxLength: 4_096, pattern: '^https?://' }),
  target: TranslateTargetSchema,
  items: Type.Array(Type.Object({
    id: SegmentIdSchema,
    text: Type.String({ minLength: 1, maxLength: TRANSLATE_ITEM_MAX_CHARS }),
  }, STRICT), { minItems: 1, maxItems: TRANSLATE_BATCH_MAX_ITEMS }),
  priority: Type.Enum(TRANSLATE_PRIORITIES),
  /** 重译：不用缓存，译完覆盖缓存里的那一份。 */
  fresh: Type.Optional(Type.Boolean()),
}, STRICT);
export type TranslateRequest = Static<typeof TranslateRequestSchema>;
export type TranslateItem = TranslateRequest['items'][number];

/** 没译成的那几段为什么没成：一句中文原因；能算出来的话带上什么时候能再试。 */
export const TranslateFailureSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
  retryAt: Type.Union([Type.String(), Type.Null()]),
  /** 一会儿就能再试（模型忙、回得不完整）；额度、登录这类要等到 retryAt 或要人去处理。 */
  retryable: Type.Boolean(),
  ids: Type.Array(SegmentIdSchema),
}, STRICT);
export type TranslateFailure = Static<typeof TranslateFailureSchema>;

export const TranslateResponseSchema = Type.Object({
  /** 实际译的模型（缓存也按它分）。 */
  model: Type.String(),
  items: Type.Array(Type.Object({ id: SegmentIdSchema, text: Type.String(), cached: Type.Boolean() }, STRICT)),
  failure: Type.Union([TranslateFailureSchema, Type.Null()]),
}, STRICT);
export type TranslateResponse = Static<typeof TranslateResponseSchema>;

/** 网站的写法：主机名小写、去掉开头的 www.；不是 http(s) 网址就是 null。 */
export function translateSiteOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' || parsed.hostname === '') {
    return null;
  }
  return parsed.hostname.toLowerCase().replace(/^www\./, '');
}

/** 这个网址是不是在这些网站里：同一个主机，或者它的子域名。 */
export function siteListed(sites: readonly string[], url: string): boolean {
  const host = translateSiteOf(url);
  return host !== null && sites.some((site) => host === site || host.endsWith(`.${site}`));
}
