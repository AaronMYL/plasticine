import { expect, it } from 'vitest';
import { NotesUi } from '../../src/state/notes-ui.ts';

it('新设备默认提供续写，已经关闭预测的设备恢复原选择', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
  const ui = new NotesUi(storage);
  expect(ui.store.get().predict).toBe(true);
  ui.set({ predict: false });
  expect(new NotesUi(storage).store.get().predict).toBe(false);
});

it('刚新建的那一篇只记在内存里：编辑器取走一次就清掉，不写进存档，别的 id 取不走', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
  const ui = new NotesUi(storage);
  ui.markFresh('note_1');
  expect(ui.store.get().freshNoteId).toBe('note_1');
  expect(JSON.parse(data.get('plasticine:notes-ui') ?? '{}')).not.toHaveProperty('freshNoteId');
  expect(ui.takeFresh('note_2')).toBe(false);
  expect(ui.store.get().freshNoteId).toBe('note_1');
  expect(ui.takeFresh('note_1')).toBe(true);
  expect(ui.store.get().freshNoteId).toBeUndefined();
  expect(ui.takeFresh('note_1')).toBe(false);
});
