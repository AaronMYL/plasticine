import { expect, it } from 'vitest';
import { NotesUi } from '../../src/state/notes-ui.ts';
import { ShellPrefs } from '../../src/state/shell-prefs.ts';
import { computeLayout } from '../../src/shell/layout.ts';
import { memoryStorage } from '../helpers.tsx';

it('读到第二篇后刷新仍回到原文，主动返回列表则保持列表，最近阅读仍可继续', () => {
  const storage = memoryStorage();
  const ui = new NotesUi(storage);
  ui.openNote({ id: 'second', title: '第二篇', private: false });
  const restored = new NotesUi(storage);
  expect(restored.store.get().activeNoteId).toBe('second');
  expect(restored.store.get().recentNotes?.[0]?.id).toBe('second');
  restored.showList();
  const list = new NotesUi(storage).store.get();
  expect(list.activeNoteId).toBeNull();
  expect(list.reading).toBe(false);
  expect(list.recentNotes?.[0]?.id).toBe('second');
});

it('私密笔记不保留标题或最近阅读记录，删除后清除对应入口', () => {
  const ui = new NotesUi();
  ui.openNote({ id: 'plain', title: '普通', private: false });
  ui.openNote({ id: 'locked', title: '秘密', private: true });
  expect(ui.store.get().recentNotes?.map((note) => note.id)).toEqual(['plain']);
  ui.forgetNote('plain');
  expect(ui.store.get().recentNotes).toEqual([]);
});

it('对话框收起与否全局记一份（设计稿 2026-11-03）：在笔记页收起，读书、信息流也是圆球；侧栏选择刷新后保留，手机全屏不自动重开', () => {
  const storage = memoryStorage();
  const prefs = new ShellPrefs(storage);
  expect(computeLayout(1440, prefs.store.get(), 'notes').chat).toBe('dialog');
  prefs.setChatOpen(false); prefs.setSidebarCollapsed(true);
  prefs.setPhoneChatOpen(true);
  const restored = new ShellPrefs(storage).store.get();
  expect(restored).toMatchObject({ chatOpen: false, sidebarCollapsed: true, phoneChatOpen: false });
  expect(computeLayout(1440, restored, 'books').chat).toBe('ball');
  expect(computeLayout(1440, restored, 'feed').chat).toBe('ball');
});
