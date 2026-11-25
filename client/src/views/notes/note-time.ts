import type { NoteMetaView } from '../../api/types.ts';

const DAY_MS = 86_400_000;
const RECENT_DAYS = 7;

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
