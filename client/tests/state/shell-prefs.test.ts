// 悬浮对话框的偏好（设计稿 2026-11-03）：展开与否、位置和大小记在本机，刷新还在；旧版右侧对话栏的按视图收起和宽度不沿用。

import { describe, expect, it } from 'vitest';
import { CHAT_FRAME_DEFAULT, ShellPrefs } from '../../src/state/shell-prefs.ts';
import { computeLayout } from '../../src/shell/layout.ts';
import { memoryStorage } from '../helpers.tsx';

describe('壳偏好 · 悬浮对话框', () => {
  it('展开与否、位置和大小刷新后还在；手机上开没开不存', () => {
    const storage = memoryStorage();
    const prefs = new ShellPrefs(storage);
    prefs.setChatOpen(false);
    prefs.setChatFrame({ width: 500, height: 700, right: 300, bottom: 80 });
    prefs.setPhoneChatOpen(true);
    const restored = new ShellPrefs(storage).store.get();
    expect(restored).toMatchObject({ chatOpen: false, chatFrame: { width: 500, height: 700, right: 300, bottom: 80 },
      phoneChatOpen: false });
    expect(computeLayout(1440, restored, 'today').chat).toBe('ball');
  });

  it('旧版的按视图收起和对话栏宽度当作没选过；坏的位置记录回到默认', () => {
    const storage = memoryStorage();
    storage.setItem('plasticine:shell-prefs', JSON.stringify({ sidebarCollapsed: true,
      chatCollapsedByView: { today: true }, chatWidth: 400, chatFrame: { width: 'wide' } }));
    const upgraded = new ShellPrefs(storage).store.get();
    expect(upgraded).toEqual({ sidebarCollapsed: true, chatOpen: null, chatFrame: CHAT_FRAME_DEFAULT,
      phoneChatOpen: false, contactProfile: true, askPage: false, collapsedColumns: [], bookmarksCollapsed: false });
    new ShellPrefs(storage).setChatOpen(true);
    expect(JSON.parse(storage.getItem('plasticine:shell-prefs') ?? '{}')).not.toHaveProperty('chatWidth');
  });

  it('联系人的资料栏开关记在本机：关掉之后刷新还是关着（第 113 条）', () => {
    const storage = memoryStorage();
    expect(new ShellPrefs(storage).store.get().contactProfile).toBe(true);
    new ShellPrefs(storage).setContactProfile(false);
    expect(new ShellPrefs(storage).store.get().contactProfile).toBe(false);
  });

  it('「问这一页」的开关记在本机：默认关着，开了刷新还开着（2026-11-04 第 2 批）', () => {
    const storage = memoryStorage();
    expect(new ShellPrefs(storage).store.get().askPage).toBe(false);
    new ShellPrefs(storage).setAskPage(true);
    expect(new ShellPrefs(storage).store.get().askPage).toBe(true);
  });
});

describe('壳偏好 · 网页栏的「书签」一节（第 8 批第 1 条）', () => {
  it('默认展开；收起了存在本机，下次打开还是收着', () => {
    const storage = memoryStorage();
    expect(new ShellPrefs(storage).store.get().bookmarksCollapsed).toBe(false);
    new ShellPrefs(storage).setBookmarksCollapsed(true);
    expect(new ShellPrefs(storage).store.get().bookmarksCollapsed).toBe(true);
  });
});

describe('壳偏好 · 第二栏收起（11-08）', () => {
  it('按栏目各记各的，存下来、下次打开还是这样；重复设一样的不变', () => {
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
