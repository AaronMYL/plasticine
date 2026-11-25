import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/shell/layout.ts';
import { HOME, parseHash, phoneRoute, routeHash } from '../../src/shell/routes.ts';
import { CHAT_FRAME_DEFAULT, type ShellPrefsState } from '../../src/state/shell-prefs.ts';

const AUTO: ShellPrefsState = {
  sidebarCollapsed: null,
  chatOpen: null,
  chatFrame: CHAT_FRAME_DEFAULT,
  phoneChatOpen: false,
  contactProfile: true,
  askPage: false,
  collapsedColumns: [],
  bookmarksCollapsed: false,
  composePredict: true,
};

describe('shell responsive folding (floating chat)', () => {
  it('at 1440px, sidebar expands and floating chat defaults open on right', () => {
    expect(computeLayout(1440, AUTO, 'today')).toEqual({ phone: false, sidebarCollapsed: false, chat: 'dialog' });
  });

  it('below 1280px, sidebar auto-collapses and untouched chat folds into bubble', () => {
    expect(computeLayout(1200, AUTO, 'today')).toMatchObject({ sidebarCollapsed: true, chat: 'ball' });
    expect(computeLayout(1000, AUTO, 'today')).toMatchObject({ sidebarCollapsed: true, chat: 'ball' });
  });

  it('manual chat preference persists across widths and views', () => {
    expect(computeLayout(1440, { ...AUTO, chatOpen: false }, 'today').chat).toBe('ball');
    expect(computeLayout(1440, { ...AUTO, chatOpen: false }, 'notes').chat).toBe('ball');
    expect(computeLayout(1000, { ...AUTO, chatOpen: true }, 'projects')).toMatchObject({ chat: 'dialog' });
    expect(computeLayout(1100, { ...AUTO, sidebarCollapsed: false }, 'notes').sidebarCollapsed).toBe(false);
  });

  it('full chat page hides floating chat and bubble; mobile defaults to bubble and opens full', () => {
    expect(computeLayout(1440, AUTO, 'conversation').chat).toBe('hidden');
    expect(computeLayout(390, AUTO, 'today')).toMatchObject({ phone: true, chat: 'ball' });
    expect(computeLayout(390, { ...AUTO, phoneChatOpen: true }, 'today').chat).toBe('dialog');
    expect(computeLayout(390, { ...AUTO, phoneChatOpen: true }, 'conversation').chat).toBe('hidden');
  });
});

describe('routes for settings, new tab, and tools', () => {
  it('legacy #/device maps to settings/system; settings sections and tools roundtrip', () => {
    expect(parseHash('#/device')).toEqual({ view: 'settings', noteId: null, settingsSection: 'system' });
    expect(routeHash(parseHash('#/device'))).toBe('#/settings/system');
    expect(parseHash('#/settings')).toEqual({ view: 'settings', noteId: null });
    expect(routeHash({ view: 'settings', noteId: null, settingsSection: 'ai' })).toBe('#/settings/ai');
    expect(routeHash({ view: 'settings', noteId: null, settingsSection: 'general' })).toBe('#/settings');
    expect(parseHash('#/tools/money')).toEqual({ view: 'tools', noteId: null, tool: '记账' });
    expect(routeHash({ view: 'tools', noteId: null, tool: '文件' })).toBe('#/tools/files');
    expect(parseHash('#/tools/nope')).toEqual({ view: 'tools', noteId: null, tool: null });
    expect(parseHash('#/newtab')).toEqual({ view: 'web', noteId: null, webTabId: null });
  });
});

describe('router', () => {
  it('parses hash routes and falls back unknown paths to today', () => {
    expect(parseHash('#/notes/note_0001')).toEqual({ view: 'notes', noteId: 'note_0001' });
    expect(parseHash('#/projects')).toEqual({ view: 'projects', noteId: null, projectId: null });
    expect(parseHash('')).toEqual(HOME);
    expect(parseHash('#/nope')).toEqual(HOME);
  });

  it('route roundtrips preserve special characters in note IDs', () => {
    const route = { view: 'notes' as const, noteId: '读书/摘记' };
    expect(parseHash(routeHash(route))).toEqual(route);
  });

  it('malformed percent encoding (#/notes/%) returns explicit invalid route without throwing', () => {
    expect(parseHash('#/notes/%')).toEqual({ view: 'notes', noteId: null, invalidNoteId: '%' });
    expect(parseHash('#/notes/%E4%BD')).toEqual({ view: 'notes', noteId: null, invalidNoteId: '%E4%BD' });
  });

  it('removed judgments routes (#/memory/judgments) resolve to memory page', () => {
    const memory = { view: 'memory', noteId: null };
    expect(parseHash('#/memory')).toEqual(memory);
    expect(parseHash('#/memory/judgments')).toEqual(memory);
    expect(parseHash('#/memory/judgments/jdg_1')).toEqual(memory);
    expect(parseHash('#/memory/judgments/%E4')).toEqual(memory);
  });

  it('legacy removed routes redirect: concerns->projects, outputs->notes, focus/cal/rem->home', () => {
    expect(parseHash('#/concerns/c1')).toEqual({ view: 'projects', noteId: null, projectId: null });
    expect(parseHash('#/artifacts/a1')).toEqual({ view: 'notes', noteId: null });
    expect(parseHash('#/tools/focus')).toEqual({ view: 'today', noteId: null });
    expect(parseHash('#/tools/calendar')).toEqual({ view: 'today', noteId: null });
    expect(parseHash('#/device')).toEqual({ view: 'settings', noteId: null, settingsSection: 'system' });
  });

  it('tasks section maps #/tasks and four tabs; unknown subpaths fall back to active', () => {
    expect(parseHash('#/tasks')).toEqual({ view: 'tasks', noteId: null, tasksSection: 'run' });
    expect(parseHash('#/tasks/timed')).toEqual({ view: 'tasks', noteId: null, tasksSection: 'timed' });
    expect(parseHash('#/tasks/t1')).toEqual({ view: 'tasks', noteId: null, tasksSection: 'run' });
    expect(routeHash({ view: 'tasks', noteId: null, tasksSection: 'ideas' })).toBe('#/tasks/ideas');
    expect(routeHash({ view: 'tasks', noteId: null, tasksSection: 'run' })).toBe('#/tasks');
  });

  it('preserves mobile routes as-is for landing or unsupported notice', () => {
    expect(phoneRoute({ view: 'books', noteId: null })).toEqual({ view: 'books', noteId: null });
    expect(phoneRoute({ view: 'projects', noteId: null })).toEqual({ view: 'projects', noteId: null });
    expect(phoneRoute({ view: 'notes', noteId: 'n1' })).toEqual({ view: 'notes', noteId: 'n1' });
  });
});
