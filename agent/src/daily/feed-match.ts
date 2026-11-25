import type { FeedSource } from '../../shared/state.ts';
import { sourceSearchTerms } from './feed-candidates.ts';

const WORD_MIN_CHARS = 2;

function termHits(term: string, haystack: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter((word) => word.length >= WORD_MIN_CHARS);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

export function matchInterest(text: string, interests: readonly FeedSource[]): FeedSource | undefined {
  const haystack = text.toLowerCase();
  return interests.find((interest) => interest.kind === 'interest' && interest.level !== 'off'
    && [interest.label, ...sourceSearchTerms(interest)].some((term) => termHits(term, haystack)));
}
