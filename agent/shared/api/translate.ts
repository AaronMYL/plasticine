import { Type, type Static } from 'typebox';
import { API_PREFIX, RequestIdSchema } from './common.ts';
import { ModelChoiceViewSchema } from './model-providers.ts';
import { Nullable } from '../state-common.ts';

export const TRANSLATE_PATH = `${API_PREFIX}/translate`;
export const TRANSLATE_SETTINGS_PATH = `${API_PREFIX}/translate/settings`;
export const TRANSLATE_MODEL_PATH = `${API_PREFIX}/translate/model`;

export const TranslateModelViewSchema = Type.Object({
  chosen: Nullable(ModelChoiceViewSchema),
  effective: Nullable(ModelChoiceViewSchema),
  version: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type TranslateModelView = Static<typeof TranslateModelViewSchema>;

export const SetTranslateModelRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  version: Type.Integer({ minimum: 0 }),
  chosen: Nullable(ModelChoiceViewSchema),
}, { additionalProperties: false });
export type SetTranslateModelRequest = Static<typeof SetTranslateModelRequestSchema>;

const STRICT = { additionalProperties: false };

export const TRANSLATE_TARGETS = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es'] as const;
export type TranslateTarget = (typeof TRANSLATE_TARGETS)[number];
export const TranslateTargetSchema = Type.Enum(TRANSLATE_TARGETS);

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

export const TRANSLATE_DISPLAYS = ['bilingual', 'translation'] as const;
export type TranslateDisplay = (typeof TRANSLATE_DISPLAYS)[number];
export const TranslateDisplaySchema = Type.Enum(TRANSLATE_DISPLAYS);

export const TRANSLATE_SITES_MAX = 200;
const SiteSchema = Type.String({ minLength: 1, maxLength: 253, pattern: '^[a-z0-9.-]+$' });

export const TranslateSettingsViewSchema = Type.Object({
  version: Type.Integer({ minimum: 0 }),
  target: TranslateTargetSchema,
  display: TranslateDisplaySchema,
  glossary: Type.Boolean(),
  alwaysSites: Type.Array(SiteSchema, { maxItems: TRANSLATE_SITES_MAX }),
}, STRICT);
export type TranslateSettingsView = Static<typeof TranslateSettingsViewSchema>;

export const SetTranslateSettingsSchema = TranslateSettingsViewSchema;
export type SetTranslateSettings = Static<typeof SetTranslateSettingsSchema>;

export const DEFAULT_TRANSLATE_SETTINGS: Omit<TranslateSettingsView, 'version'> = {
  target: 'zh-CN',
  display: 'bilingual',
  glossary: true,
  alwaysSites: [],
};

export const TRANSLATE_BATCH_MAX_ITEMS = 24;
export const TRANSLATE_ITEM_MAX_CHARS = 4_000;
export const TRANSLATE_BATCH_MAX_CHARS = 12_000;
export const TRANSLATE_MODEL_TIMEOUT_MS = 60_000;
const SegmentIdSchema = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_:.-]+$' });

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
  fresh: Type.Optional(Type.Boolean()),
}, STRICT);
export type TranslateRequest = Static<typeof TranslateRequestSchema>;
export type TranslateItem = TranslateRequest['items'][number];

export const TranslateFailureSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
  retryAt: Type.Union([Type.String(), Type.Null()]),
  retryable: Type.Boolean(),
  ids: Type.Array(SegmentIdSchema),
}, STRICT);

export const TranslateResponseSchema = Type.Object({
  model: Type.String(),
  items: Type.Array(Type.Object({ id: SegmentIdSchema, text: Type.String(), cached: Type.Boolean() }, STRICT)),
  failure: Type.Union([TranslateFailureSchema, Type.Null()]),
}, STRICT);
export type TranslateResponse = Static<typeof TranslateResponseSchema>;

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

export function siteListed(sites: readonly string[], url: string): boolean {
  const host = translateSiteOf(url);
  return host !== null && sites.some((site) => host === site || host.endsWith(`.${site}`));
}
