// 订阅和 X 的条目不经模型选材，命中关注点靠字面：关注点的名字或搜索词出现在标题 / 正文里就算命中（第 3 批 11-04：
// 命中关注点的排前面，带陶土橙点和关注点名）。英文多词的搜索词要每个词都出现；中文整段出现。不分大小写。

import type { FeedSource } from '../../shared/state.ts';
import { sourceSearchTerms } from './feed-candidates.ts';

// 一个词至少两个字符才拿来比：单个字母、单个汉字太容易误中。
const WORD_MIN_CHARS = 2;

function termHits(term: string, haystack: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter((word) => word.length >= WORD_MIN_CHARS);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}

/** 第一个命中的关注点（按传入的先后）；都不中就是 undefined。关掉的关注点不参与。 */
export function matchInterest(text: string, interests: readonly FeedSource[]): FeedSource | undefined {
  const haystack = text.toLowerCase();
  return interests.find((interest) => interest.kind === 'interest' && interest.level !== 'off'
    && [interest.label, ...sourceSearchTerms(interest)].some((term) => termHits(term, haystack)));
}
