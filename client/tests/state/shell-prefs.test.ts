import { describe, expect, it } from 'vitest';
import { CHAT_FRAME_DEFAULT, ShellPrefs } from '../../src/state/shell-prefs.ts';
import { computeLayout } from '../../src/shell/layout.ts';
import { memoryStorage } from '../helpers.tsx';

describe('shell preferences: floating chat', () => {
  it('persists open state, position, and size across reload; skips mobile open state', () => {
    const storage = memoryStorage();
    const prefs = new ShellPrefs(storage);
    prefs.setChatOpen(false);
    prefs.setChatFrame({ width: 500, height: 700, right: 300, bottom: 80, full: false });
    prefs.setPhoneChatOpen(true);
    const restored = new ShellPrefs(storage).store.get();
    expect(restored).toMatchObject({ chatOpen: false,
      chatFrame: { width: 500, height: 700, right: 300, bottom: 80, full: false }, phoneChatOpen: false });
    expect(computeLayout(1440, restored, 'today').chat).toBe('ball');
  });

  it('legacy saved size without fullHeight defaults to full height keeping width', () => {
    const storage = memoryStorage();
    storage.setItem('plasticine:shell-prefs', JSON.stringify({ chatFrame: { width: 480, height: 640, right: 24,
      bottom: 24 } }));
    expect(new ShellPrefs(storage).store.get().chatFrame).toEqual({ width: 480, height: 640, right: 24, bottom: 24,
      full: true });
  });

  it('ignores legacy per-view collapse and dock width; resets corrupt position to default', () => {
    const storage = memoryStorage();
    storage.setItem('plasticine:shell-prefs', JSON.stringify({ sidebarCollapsed: true,
      chatCollapsedByView: { today: true }, chatWidth: 400, chatFrame: { width: 'wide' } }));
    const upgraded = new ShellPrefs(storage).store.get();
    expect(upgraded).toEqual({ sidebarCollapsed: true, chatOpen: null, chatFrame: CHAT_FRAME_DEFAULT,
      phoneChatOpen: false, contactProfile: true, askPage: false, collapsedColumns: [], bookmarksCollapsed: false,
      composePredict: true });
    new ShellPrefs(storage).setChatOpen(true);
    expect(JSON.parse(storage.getItem('plasticine:shell-prefs') ?? '{}')).not.toHaveProperty('chatWidth');
  });

  it('contact profile pane toggle persists locally across reload', () => {
    const storage = memoryStorage();
    expect(new ShellPrefs(storage).store.get().contactProfile).toBe(true);
    new ShellPrefs(storage).setContactProfile(false);
    expect(new ShellPrefs(storage).store.get().contactProfile).toBe(false);
  });

  it('ask-this-page toggle defaults off and persists locally when enabled', () => {
    const storage = memoryStorage();
    expect(new ShellPrefs(storage).store.get().askPage).toBe(false);
    new ShellPrefs(storage).setAskPage(true);
    expect(new ShellPrefs(storage).store.get().askPage).toBe(true);
  });
});

describe('shell preferences: web rail Bookmarks section', () => {
  it('defaults expanded and persists collapsed state locally', () => {
    const storage = memoryStorage();
    expect(new ShellPrefs(storage).store.get().bookmarksCollapsed).toBe(false);
    new ShellPrefs(storage).setBookmarksCollapsed(true);
    expect(new ShellPrefs(storage).store.get().bookmarksCollapsed).toBe(true);
  });
});

describe('shell preferences: secondary column collapse', () => {
  it('persists independently per section and ignores redundant identical updates', () => {
    const storage = memoryStorage();
    const prefs = new ShellPrefs(storage);
    prefs.setColumnCollapsed('web', true);
    prefs.setColumnCollapsed('notes', true);
    const before = prefs.store.get();
    prefs.setColumnCollapsed('web', true);
    expect(prefs.store.get()).toBe(before);
    prefs.setColumnCollapsed('notes', false);
    expect(new ShellPrefs(storage).store.get().collapsedColumns).toEqual(['web']);
  });
});
