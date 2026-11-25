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
