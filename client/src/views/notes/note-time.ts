// 笔记列表的时间写法和分组（照旧版 notes.ts 的 when() 与 NotesPage 的 groupByDay 重写）。
// 一律按本机时区：今天写时分，昨天写「昨天」，今年写「月/日」，更早带年份。

import type { NoteMetaView } from '../../api/types.ts';
import { timeInput } from '../../primitives/message/states.ts';
import { deviceTimeZone } from '../../state/time-zone.ts';

const DAY_MS = 86_400_000;
/** 「前 7 天」这一组的范围。 */
const RECENT_DAYS = 7;

export function when(iso: string, now: Date, timeZone = deviceTimeZone()): string {
  const local = timeInput(iso, timeZone);
  const day = local.slice(0, 10);
  const today = timeInput(now.toISOString(), timeZone).slice(0, 10);
  if (day === today) {
    return local.slice(11);
  }
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  if (yesterday === day) {
    return '昨天';
  }
  const [year, month, date] = day.split('-').map(Number);
  return `${day.slice(0, 4) === today.slice(0, 4) ? '' : `${year}/`}${month}/${date}`;
}

export interface NoteGroup {
  label: string;
  notes: NoteMetaView[];
}

function groupLabel(note: NoteMetaView, now: Date): string {
  if (note.pinned) {
    return '置顶';
  }
  const date = new Date(note.updatedAt);
  if (date.toDateString() === now.toDateString()) {
    return '今天';
  }
  if (new Date(now.getTime() - DAY_MS).toDateString() === date.toDateString()) {
    return '昨天';
  }
  if (now.getTime() - date.getTime() < RECENT_DAYS * DAY_MS) {
    return '前 7 天';
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

/** 按列表原来的顺序分组，组的顺序跟着第一次出现；「置顶」总在最上面。 */
export function groupByDay(notes: NoteMetaView[], now: Date): NoteGroup[] {
  const groups: NoteGroup[] = [];
  for (const note of notes) {
    const label = groupLabel(note, now);
    const group = groups.find((candidate) => candidate.label === label);
    if (group === undefined) {
      groups.push({ label, notes: [note] });
    } else {
      group.notes.push(note);
    }
  }
  return groups.sort((a, b) => Number(b.label === '置顶') - Number(a.label === '置顶'));
}
