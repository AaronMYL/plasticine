import { describe, expect, it } from 'vitest';
import type { NoteMetaView } from '../../../src/api/types.ts';
import { groupByDay } from '../../../src/views/notes/note-time.ts';

const NOW = new Date(2026, 9, 21, 10, 0);

function meta(id: string, updatedAt: Date, pinned = false): NoteMetaView {
  return {
    id,
    title: id,
    folder: 'notes',
    pinned,
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    preview: '',
    bytes: 0,
    version: 1,
    author: 'user',
    readOnly: false,
    deletedAt: null,
    migrated: false,
  };
}

describe('Note list timestamps', () => {
  it('groups pinned first, then Today, Yesterday, Last 7 days, and by year-month', () => {
    const notes = [
      meta('today', new Date(2026, 9, 21, 9)),
      meta('pinned', new Date(2026, 0, 1), true),
      meta('yesterday', new Date(2026, 9, 20, 9)),
      meta('week', new Date(2026, 9, 17, 9)),
      meta('old', new Date(2026, 6, 3)),
    ];
    const groups = groupByDay(notes, NOW);
    expect(groups.map((group) => group.label)).toEqual(['置顶', '今天', '昨天', '前 7 天', '2026 年 7 月']);
    expect(groups[0]?.notes.map((note) => note.id)).toEqual(['pinned']);
  });

  it('produces no groups for empty list', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
