import { expect, it } from 'vitest';
import { applyNoteChanges, noteChanges } from '../../../src/views/notes/note-diff.ts';

it('逐段选择而不覆盖未选择部分，对照时新添的一句保留', () => {
  const base = '# 标题\n\n甲段\n\n乙段';
  const changes = noteChanges(base, '# 标题\n\n甲段改\n\n乙段改');
  expect(changes).toHaveLength(2);
  expect(applyNoteChanges(base, `${base}\n\n新的一句`, [changes[0]!]))
    .toBe('# 标题\n\n甲段改\n\n乙段\n\n新的一句');
});
it('对照时同一处又写过，说明具体冲突而不覆盖', () => {
  expect(() => applyNoteChanges('旧话', '我新写的话', noteChanges('旧话', '建议'))).toThrow('又改过');
});
it('新增、删除、重复行与全空正文可正确重建', () => {
  for (const [before, after] of [['', '新正文'], ['一\n二\n三', '一\n三'], ['一\n一\n二', '一\n改\n一\n二']]) {
    expect(applyNoteChanges(before!, before!, noteChanges(before!, after!))).toBe(after);
  }
});
