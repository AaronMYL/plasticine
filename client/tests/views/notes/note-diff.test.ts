import { describe, expect, it } from 'vitest';
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

describe('原文最后一行没有换行', () => {
  it('在最后一行后面接着写，不算改了那一行：最后一处照样能采用（11-17）', () => {
    const base = '# 思路\n\n甲段\n\n乙段';
    const changes = noteChanges(base, '# 思路\n\n甲段改\n\n乙段改');
    const current = `${base}\n\n继续写下的一句`;
    expect(applyNoteChanges(base, current, changes)).toBe('# 思路\n\n甲段改\n\n乙段改\n\n继续写下的一句');
  });

  it('最后一行本身改过，仍然算冲突', () => {
    const base = '# 思路\n\n甲段\n\n乙段';
    const changes = noteChanges(base, '# 思路\n\n甲段\n\n乙段改');
    expect(() => applyNoteChanges(base, `${base}又加了字`, changes)).toThrow('对照期间又改过了');
  });
});
