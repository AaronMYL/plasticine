import type { Space } from '../../shared/state.ts';
import { followTexts } from './space-page.ts';

const FOLLOW_UP_HEADING = '值得跟进';
const TITLE_MAX_CHARS = 60;
const PER_ISSUE_MAX = 3;
const TITLE_MIN_CHARS = 5;
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

export function followUps(space: Space): FollowUp[] {
  const found = space.html === null ? docFollowUps(space) : followTexts(space.html);
  return found.map((text, index) => ({ index, text: text.replace(LEADING, '').trim() }))
    .filter((item) => Array.from(item.text).length >= TITLE_MIN_CHARS)
    .slice(0, PER_ISSUE_MAX)
    .map((item) => ({ key: `review:${space.id}:${item.index + 1}`, title: clip(item.text, TITLE_MAX_CHARS),
      goal: clip(`回顾《${space.title}》里「值得跟进」的一条：${item.text}\n先读这一期（space:${space.id}）弄清前后文，再动手做。`,
        GOAL_MAX_CHARS) }));
}
