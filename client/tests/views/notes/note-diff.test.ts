import { describe, expect, it } from 'vitest';
import { applyNoteChanges, noteChanges } from '../../../src/views/notes/note-diff.ts';

it('applies selected hunks without overwriting unselected ones and preserves new line during diff', () => {
  const base = '# 标题\n\n甲段\n\n乙段';
  const changes = noteChanges(base, '# 标题\n\n甲段改\n\n乙段改');
  expect(changes).toHaveLength(2);
  expect(applyNoteChanges(base, `${base}\n\n新的一句`, [changes[0]!]))
    .toBe('# 标题\n\n甲段改\n\n乙段\n\n新的一句');
});
it('reports exact conflict without overwriting when same region was edited during diff', () => {
  expect(() => applyNoteChanges('旧话', '我新写的话', noteChanges('旧话', '建议'))).toThrow('又改过');
});
it('reconstructs insertions, deletions, duplicate lines, and empty body accurately', () => {
  for (const [before, after] of [['', '新正文'], ['一\n二\n三', '一\n三'], ['一\n一\n二', '一\n改\n一\n二']]) {
    expect(applyNoteChanges(before!, before!, noteChanges(before!, after!))).toBe(after);
  }
});

describe('Original last line without trailing newline', () => {
  it('appending after last line does not count as editing it, so last hunk still applies', () => {
    const base = '# 思路\n\n甲段\n\n乙段';
    const changes = noteChanges(base, '# 思路\n\n甲段改\n\n乙段改');
    const current = `${base}\n\n继续写下的一句`;
    expect(applyNoteChanges(base, current, changes)).toBe('# 思路\n\n甲段改\n\n乙段改\n\n继续写下的一句');
  });

  it('editing last line itself still counts as a conflict', () => {
    const base = '# 思路\n\n甲段\n\n乙段';
    const changes = noteChanges(base, '# 思路\n\n甲段\n\n乙段改');
    expect(() => applyNoteChanges(base, `${base}又加了字`, changes)).toThrow('对照期间又改过了');
  });
});
