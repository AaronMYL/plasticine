import { Type } from 'typebox';

const MAX_TERMS = 2;
export function searchTerms(input: { label: string; query: string | null; custom: boolean }): string[] {
  if (input.custom) {
    return [input.query?.trim() || input.label.trim()];
  }
  const parts = input.label.split(/\s*(?:与|和|及|、|,|，|\/|&|\+)\s*/)
    .map((part) => part.trim()).filter((part) => part.length >= 2);
  return (parts.length === 0 ? [input.label.trim()] : parts).slice(0, MAX_TERMS);
}

export const FeedBannedTermsSchema = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }),
  { maxItems: 100 }));
