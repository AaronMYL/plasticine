// 沉浸式翻译（2026-11-03 第 2 批）存在库里的两样（迁移 0046）：翻译设置一行，和译文缓存。缓存只存原文的散列和译文，
// 不存原文；按（原文散列、目标语言、模型、这段用到的词表散列）分。Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { RECORD_META } from './state-common.ts';
import { TranslateDisplaySchema, TranslateTargetSchema, TRANSLATE_SITES_MAX } from './api/translate.ts';

export const TranslateSettingsSchema = Type.Object({
  ...RECORD_META,
  target: TranslateTargetSchema,
  display: TranslateDisplaySchema,
  glossary: Type.Boolean(),
  alwaysSites: Type.Array(Type.String({ minLength: 1 }), { maxItems: TRANSLATE_SITES_MAX }),
});
export type TranslateSettings = Static<typeof TranslateSettingsSchema>;

/** 缓存的键：sha256(规整后的原文)、目标语言、实际用的模型、这段用到的词表的散列（没用词表是空串）。 */
export const TranslationKeySchema = Type.Object({
  sourceHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  target: TranslateTargetSchema,
  model: Type.String({ minLength: 1 }),
  glossaryHash: Type.String(),
}, { additionalProperties: false });
export type TranslationKey = Static<typeof TranslationKeySchema>;

export const TranslationEntrySchema = Type.Object({
  ...TranslationKeySchema.properties,
  text: Type.String(),
  sourceChars: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });
export type TranslationEntry = Static<typeof TranslationEntrySchema>;
