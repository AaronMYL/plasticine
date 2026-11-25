import { FEED_LONG_TEXT_CHARS } from '../../api/shared.ts';
import type { FeedItemView } from '../../api/types.ts';

export const LEAD_MAX_CHARS = 120;
const MIN_CUT_RATIO = 0.4;
const SENTENCE_END = /[。！？!?；;…\n]/u;

export interface FeedText {
  lead: string;
  faded: boolean;
  expandable: boolean;
  full: string;
  original: string;
  from: string | null;
  title: string;
}

export function cutAtSentence(text: string, max: number): { text: string; cut: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return { text, cut: false };
  }
  const endsSentence = (index: number): boolean => {
    const char = chars[index] ?? '';
    return char === '.' ? /\s/u.test(chars[index + 1] ?? ' ') : SENTENCE_END.test(char);
  };
  let end = -1;
  for (let index = Math.ceil(max * MIN_CUT_RATIO) - 1; index < max; index += 1) {
    if (endsSentence(index)) {
      end = index + 1;
    }
  }
  if (end < 0) {
    return { text: `${chars.slice(0, max).join('').trimEnd()}…`, cut: true };
  }
  return { text: chars.slice(0, end).join('').trimEnd(), cut: true };
}

export function feedText(item: Pick<FeedItemView, 'kind' | 'title' | 'summary' | 'zh'>): FeedText {
  const post = item.kind === 'x';
  const same = !post && item.summary.trim() === item.title.trim();
  const original = post ? item.summary || item.title : same ? '' : item.summary;
  const zh = item.zh ?? null;
  const translated = zh !== null && zh.state === 'done' && zh.text !== null && zh.text !== '';
  const full = translated ? zh.text ?? original : original;
  const from = translated ? zh.from : null;
  const title = zh?.title ?? item.title;
  const long = Array.from(original).length > FEED_LONG_TEXT_CHARS;
  if (!long) {
    return { lead: full, faded: false, expandable: false, full, original, from, title };
  }
  const digest = zh?.digest ?? null;
  const lead = digest !== null && digest !== '' ? cutAtSentence(digest, LEAD_MAX_CHARS * 2)
    : cutAtSentence(full, LEAD_MAX_CHARS);
  return { lead: lead.text, faded: lead.cut, expandable: true, full, original, from, title };
}
