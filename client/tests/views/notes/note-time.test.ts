import { describe, expect, it } from 'vitest';
import type { NoteMetaView } from '../../../src/api/types.ts';
import { groupByDay, when } from '../../../src/views/notes/note-time.ts';

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
    private: false,
    readOnly: false,
    deletedAt: null,
    migrated: false,
  };
}

describe('笔记列表的时间', () => {
  it('今天写时分，昨天写「昨天」，今年写月/日，更早带年份', () => {
    expect(when(new Date(2026, 9, 21, 8, 5).toISOString(), NOW)).toBe('08:05');
    expect(when(new Date(2026, 9, 20, 8, 5).toISOString(), NOW)).toBe('昨天');
    expect(when(new Date(2026, 9, 1, 8, 5).toISOString(), NOW)).toBe('10/1');
    expect(when(new Date(2024, 10, 5).toISOString(), NOW)).toBe('2024/11/5');
  });

  it('分组：置顶在最上面，然后今天、昨天、前 7 天、按年月', () => {
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

  it('空列表没有分组', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
