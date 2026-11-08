// 回顾的「值得跟进」进建议（《优化清单》第 4、7 条）：日报、周报写完以后，最后一节「值得跟进」里的每一条出一张建议卡，
// 他点了才开始做。同一期同一条只提一次（key = review:<空间>:<第几条>）。

import type { Space } from '../../shared/state.ts';

/** 这一节的标题里有这几个字就算。 */
const FOLLOW_UP_HEADING = '值得跟进';
const TITLE_MAX_CHARS = 60;
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

export function followUps(space: Space): FollowUp[] {
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
  return found.map((text, index) => ({ key: `review:${space.id}:${index + 1}`, title: clip(text, TITLE_MAX_CHARS),
    goal: clip(text, GOAL_MAX_CHARS) }));
}
