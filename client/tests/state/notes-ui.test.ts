import { expect, it } from 'vitest';
import { NotesUi } from '../../src/state/notes-ui.ts';

it('new device enables inline completion by default; opted-out device restores off state', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); } };
  const ui = new NotesUi(storage);
  expect(ui.store.get().predict).toBe(true);
  ui.set({ predict: false });
  expect(new NotesUi(storage).store.get().predict).toBe(false);
});

it('newly created note stays in memory only, consumed once by matching ID without persisting', () => {
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
