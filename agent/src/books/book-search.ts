import { BOOK_SEARCH_MAX_HITS, type BookSearchHit } from '../../shared/api/index.ts';

const CONTEXT_CHARS = 40;
const TERMS_WINDOW_CHARS = 200;

export interface SearchableChapter {
  title: string;
  text: string;
}

export interface BookSearchResult {
  hits: BookSearchHit[];
  truncated: boolean;
}

function hit(chapter: number, source: SearchableChapter, start: number, end: number): BookSearchHit {
  return {
    chapter,
    chapterTitle: source.title,
    start,
    end,
    before: source.text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    match: source.text.slice(start, end),
    after: source.text.slice(end, end + CONTEXT_CHARS),
  };
}

function phraseHits(chapters: readonly SearchableChapter[], phrase: string, limit: number): BookSearchResult {
  const hits: BookSearchHit[] = [];
  const needle = phrase.toLowerCase();
  for (const [index, chapter] of chapters.entries()) {
    const haystack = chapter.text.toLowerCase();
    let from = haystack.indexOf(needle);
    while (from !== -1) {
      if (hits.length === limit) {
        return { hits, truncated: true };
      }
      hits.push(hit(index, chapter, from, from + needle.length));
      from = haystack.indexOf(needle, from + needle.length);
    }
  }
  return { hits, truncated: false };
}

function termsHits(chapters: readonly SearchableChapter[], terms: readonly string[], limit: number): BookSearchResult {
  const hits: BookSearchHit[] = [];
  const [first, ...rest] = terms.map((term) => term.toLowerCase());
  if (first === undefined) {
    return { hits, truncated: false };
  }
  for (const [index, chapter] of chapters.entries()) {
    const haystack = chapter.text.toLowerCase();
    let from = haystack.indexOf(first);
    while (from !== -1) {
      const window = haystack.slice(Math.max(0, from - TERMS_WINDOW_CHARS), from + TERMS_WINDOW_CHARS);
      if (rest.every((term) => window.includes(term))) {
        if (hits.length === limit) {
          return { hits, truncated: true };
        }
        hits.push(hit(index, chapter, from, from + first.length));
        from = haystack.indexOf(first, from + TERMS_WINDOW_CHARS);
      } else {
        from = haystack.indexOf(first, from + first.length);
      }
    }
  }
  return { hits, truncated: false };
}

export function searchBook(chapters: readonly SearchableChapter[], query: string,
  limit: number = BOOK_SEARCH_MAX_HITS): BookSearchResult {
  const phrase = query.trim();
  if (phrase === '') {
    return { hits: [], truncated: false };
  }
  const exact = phraseHits(chapters, phrase, limit);
  const terms = phrase.split(/\s+/).filter((term) => term !== '');
  if (exact.hits.length > 0 || terms.length < 2) {
    return exact;
  }
  return termsHits(chapters, terms, limit);
}
