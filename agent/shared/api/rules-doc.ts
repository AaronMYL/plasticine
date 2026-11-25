import { Type, type Static } from 'typebox';
export { hardLines, HARD_LINES_HEADING, HARD_LINES_NOTE } from '../rules-doc.ts';

export const RulesOfferItemSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' }),
    text: Type.String({ minLength: 1, maxLength: 500 }),
    quote: Type.String({ minLength: 1, maxLength: 1_000 }),
    said: Type.String({ minLength: 1, maxLength: 40 }),
  },
  { additionalProperties: false },
);
export type RulesOfferItem = Static<typeof RulesOfferItemSchema>;

