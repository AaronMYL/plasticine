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
};

describe('壳怎么折（悬浮对话框，设计稿 2026-11-03）', () => {
  it('1440：侧栏展开，对话框默认展开', () => {
    expect(computeLayout(1440, AUTO, 'today')).toEqual({ phone: false, sidebarCollapsed: false, chat: 'dialog' });
  });

  it('窄于 1280 侧栏自动收，对话框没选过时缩成圆球', () => {
    expect(computeLayout(1200, AUTO, 'today')).toMatchObject({ sidebarCollapsed: true, chat: 'ball' });
    expect(computeLayout(1000, AUTO, 'today')).toMatchObject({ sidebarCollapsed: true, chat: 'ball' });
  });

  it('手动选过的照选的来：宽窗口里收起是圆球，窄窗口里展开是浮窗；对话框不按视图分', () => {
    expect(computeLayout(1440, { ...AUTO, chatOpen: false }, 'today').chat).toBe('ball');
    expect(computeLayout(1440, { ...AUTO, chatOpen: false }, 'notes').chat).toBe('ball');
    expect(computeLayout(1000, { ...AUTO, chatOpen: true }, 'projects').chat).toBe('dialog');
    expect(computeLayout(1100, { ...AUTO, sidebarCollapsed: false }, 'notes').sidebarCollapsed).toBe(false);
  });

  it('对话整页不显示对话框和圆球；手机上平时是圆球，展开是全屏', () => {
    expect(computeLayout(1440, AUTO, 'conversation').chat).toBe('hidden');
    expect(computeLayout(390, AUTO, 'today')).toMatchObject({ phone: true, chat: 'ball' });
    expect(computeLayout(390, { ...AUTO, phoneChatOpen: true }, 'today').chat).toBe('dialog');
    expect(computeLayout(390, { ...AUTO, phoneChatOpen: true }, 'conversation').chat).toBe('hidden');
  });
});

describe('设置、新标签页、工具的地址（设计稿 2026-11-03）', () => {
  it('旧地址 #/device 到设置 · 系统；设置各段、工具来回转换不变', () => {
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

describe('路由', () => {
  it('解析 # 段，未知的回到今日', () => {
    expect(parseHash('#/notes/note_0001')).toEqual({ view: 'notes', noteId: 'note_0001' });
    expect(parseHash('#/projects')).toEqual({ view: 'projects', noteId: null, projectId: null });
    expect(parseHash('')).toEqual(HOME);
    expect(parseHash('#/nope')).toEqual(HOME);
  });

  it('来回转换不变，笔记 id 里的特殊字也行', () => {
    const route = { view: 'notes' as const, noteId: '读书/摘记' };
    expect(parseHash(routeHash(route))).toEqual(route);
  });

  it('不完整的百分号编码（#/notes/%）不抛错：返回明确的无效路由，原样带着那一段', () => {
    expect(parseHash('#/notes/%')).toEqual({ view: 'notes', noteId: null, invalidNoteId: '%' });
    expect(parseHash('#/notes/%E4%BD')).toEqual({ view: 'notes', noteId: null, invalidNoteId: '%E4%BD' });
  });

  it('判断删了（2026-11-05）：#/memory/judgments 带不带一段都是记忆页', () => {
    const memory = { view: 'memory', noteId: null };
    expect(parseHash('#/memory')).toEqual(memory);
    expect(parseHash('#/memory/judgments')).toEqual(memory);
    expect(parseHash('#/memory/judgments/jdg_1')).toEqual(memory);
    expect(parseHash('#/memory/judgments/%E4')).toEqual(memory);
  });

  it('删掉的页（2026-11-05）的旧地址落到新页面：关切去项目，成果去笔记，专注 / 日历 / 提醒回首页', () => {
    expect(parseHash('#/concerns/c1')).toEqual({ view: 'projects', noteId: null, projectId: null });
    expect(parseHash('#/artifacts/a1')).toEqual({ view: 'notes', noteId: null });
    expect(parseHash('#/tools/focus')).toEqual({ view: 'today', noteId: null });
    expect(parseHash('#/tools/calendar')).toEqual({ view: 'today', noteId: null });
    expect(parseHash('#/device')).toEqual({ view: 'settings', noteId: null, settingsSection: 'system' });
  });

  it('任务栏目（11-07《优化清单》第 3 条）：#/tasks 是在做，四段各有地址；认不得的段（旧任务详情）落到在做', () => {
    expect(parseHash('#/tasks')).toEqual({ view: 'tasks', noteId: null, tasksSection: 'run' });
    expect(parseHash('#/tasks/timed')).toEqual({ view: 'tasks', noteId: null, tasksSection: 'timed' });
    expect(parseHash('#/tasks/t1')).toEqual({ view: 'tasks', noteId: null, tasksSection: 'run' });
    expect(routeHash({ view: 'tasks', noteId: null, tasksSection: 'ideas' })).toBe('#/tasks/ideas');
    expect(routeHash({ view: 'tasks', noteId: null, tasksSection: 'run' })).toBe('#/tasks');
  });

  it('手机上的地址原样保留（承接页或不支持说明）', () => {
    expect(phoneRoute({ view: 'books', noteId: null })).toEqual({ view: 'books', noteId: null });
    expect(phoneRoute({ view: 'projects', noteId: null })).toEqual({ view: 'projects', noteId: null });
    expect(phoneRoute({ view: 'notes', noteId: 'n1' })).toEqual({ view: 'notes', noteId: 'n1' });
  });
});
