// 回顾的「值得跟进」进建议（《优化清单》第 4、7 条）：日报、周报写完以后，值得跟进的每一条出一张建议卡，他点了才开始
// 做。同一期同一条只提一次（key = review:<空间>:<第几条>）。11-09 起回顾是来信：信里标了 data-follow 的那几条；
// 旧版式（还没重写）照旧读最后一节「值得跟进」。

import type { Space } from '../../shared/state.ts';
import { followTexts } from './space-page.ts';

/** 这一节的标题里有这几个字就算。 */
const FOLLOW_UP_HEADING = '值得跟进';
const TITLE_MAX_CHARS = 60;
/** 一期最多提三条（11-12：线上堆了 13 条半句话）；再多他不会一条条看，后面的留在信里。 */
const PER_ISSUE_MAX = 3;
/** 短过这么多字的多半是半句话（「最后，」「另外：」），不提。 */
const TITLE_MIN_CHARS = 5;
/** 一条开头的序号和承接词：单独拿出来当标题时没有意义。 */
const LEADING = /^(?:[（(]?\d+[）)．.、]\s*|第[一二三四五六七八九十]+[，,、：:]\s*|(?:最后|另外|其次|首先|此外|同时|然后)[，,、：:]\s*)+/;
const GOAL_MAX_CHARS = 2_000;

export interface FollowUp {
  key: string;
  title: string;
  goal: string;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** 一段 Markdown 拆成条：列表的每一项一条；不是列表就每段一条。出处标记 [^n] 和加粗去掉。 */
function items(markdown: string): string[] {
  const lines = markdown.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const listed = lines.filter((line) => /^([-*•]|\d+[.、)])\s+/.test(line));
  const raw = listed.length > 0 ? listed : lines;
  return raw.map((line) => line.replace(/^([-*•]|\d+[.、)])\s+/, '').replace(/\[\^\d+\]/g, '')
    .replace(/\*\*/g, '').trim()).filter((line) => line !== '');
}

function docFollowUps(space: Space): string[] {
  const blocks = space.doc.blocks;
  const start = blocks.findIndex((block) => block.type === 'heading' && block.text.includes(FOLLOW_UP_HEADING));
  if (start === -1) {
    return [];
  }
  const found: string[] = [];
  for (const block of blocks.slice(start + 1)) {
    if (block.type === 'heading') {
      break;
    }
    if (block.type === 'text') {
      found.push(...items(block.markdown));
    }
  }
  return found;
}

/**
 * 一条建议要能单独看懂：标题去掉序号和「最后，」这类承接词，太短的半句不提；交给后台线的话带上出自哪一期，
 * 让它先读那一期再做。key 仍按原来的位置编（同一期同一条只提一次，改规则以后也不会把提过的再提一遍）。
 */
export function followUps(space: Space): FollowUp[] {
  const found = space.html === null ? docFollowUps(space) : followTexts(space.html);
  return found.map((text, index) => ({ index, text: text.replace(LEADING, '').trim() }))
    .filter((item) => Array.from(item.text).length >= TITLE_MIN_CHARS)
    .slice(0, PER_ISSUE_MAX)
    .map((item) => ({ key: `review:${space.id}:${item.index + 1}`, title: clip(item.text, TITLE_MAX_CHARS),
      goal: clip(`回顾《${space.title}》里「值得跟进」的一条：${item.text}\n先读这一期（space:${space.id}）弄清前后文，再动手做。`,
        GOAL_MAX_CHARS) }));
}
