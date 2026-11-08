// 信息流卡片上显示什么字（《优化清单》第 8 条，11-06 定）：外语帖抓取时就翻好了（服务端存的 zh），这里只挑着显示，
// 不再翻。短帖直接显示中文全文；长帖先给中文摘要，点「展开」原地展开中文全文；展开后能切到原文。要截断的地方按句子
// 断开、末尾渐隐，不在半句话中间硬切。

import { FEED_LONG_TEXT_CHARS } from '../../api/shared.ts';
import type { FeedItemView } from '../../api/types.ts';

/** 长帖没有摘要时，卡片上先露这么多字（按句子断开）。 */
export const LEAD_MAX_CHARS = 120;
// 断句只在这个比例之后找：太靠前断开，露出来的就只剩半行。
const MIN_CUT_RATIO = 0.4;
const SENTENCE_END = /[。！？!?；;…\n]/u;

export interface FeedText {
  /** 卡片上先显示的：短帖是全文，长帖是中文摘要（没有摘要就按句子截的开头）。 */
  lead: string;
  /** lead 是截出来的（末尾渐隐）。 */
  faded: boolean;
  /** 能展开（长帖）。 */
  expandable: boolean;
  /** 展开后的全文：有译文用译文，没有就是原文。 */
  full: string;
  /** 原文。 */
  original: string;
  /** 「译自英文」的语言名；没翻（中文原文、还没翻好）是 null。 */
  from: string | null;
  /** 卡片标题：有中文标题用中文的。 */
  title: string;
}

/** 按句子截到 max 字以内；一个句子边界都没有就硬切加省略号。 */
export function cutAtSentence(text: string, max: number): { text: string; cut: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) {
    return { text, cut: false };
  }
  // 英文句号后面得是空白（不在 4.8、e.g 里断开）。
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
  const original = post ? item.summary || item.title : item.summary;
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
