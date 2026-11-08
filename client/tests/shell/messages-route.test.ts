// 地址（11-07 两层侧栏）：Plasticine 是自己的栏目（#/plasticine 主线、#/plasticine/side/<线> 旁聊），消息里只有人、群、
// 邮件（#/messages、#/messages/<id>、#/messages/<id>/profile、#/messages/requests）；只有网页是标签（#/web/<id>）。
// 旧链接 #/conversation…、#/messages/plasticine…、#/contacts…、#/inbox…、#/bookmarks、#/newtab 都落到新的地方。
// 图标栏：现在、Plasticine、消息、任务 ｜ 网页、信息流 ｜ 笔记、资料库；手机底栏 现在 · Plasticine · 消息 · 笔记 · 更多。

import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, navLabel, parseHash, routeHash } from '../../src/shell/routes.ts';
import { MORE_ITEMS, PHONE_TABS, RAIL_GROUPS, SECTIONS, phoneTabOf, sectionOf } from '../../src/shell/sections.ts';

describe('地址和栏目', () => {
  it('主线、旁聊、消息、网页标签来回都对得上', () => {
    const mail = `#/messages/${encodeURIComponent('mail:noreply@aliyun.com')}`;
    for (const hash of ['#/plasticine', '#/plasticine/line%3Al1%3A3', '#/plasticine/side/l2', '#/messages',
      '#/messages/c_linyi', '#/messages/c_linyi/profile', '#/messages/requests', mail, '#/web', '#/web/t1',
      '#/books/space', '#/books/space/s1']) {
      expect(routeHash(parseHash(hash))).toBe(hash);
    }
    expect(parseHash('#/plasticine/side/l2')).toMatchObject({ view: 'plasticine', lineId: 'l2' });
    expect(parseHash('#/plasticine/msg_1')).toMatchObject({ view: 'plasticine', messageId: 'msg_1' });
    expect(parseHash('#/web/t1')).toMatchObject({ view: 'web', webTabId: 't1' });
    expect(parseHash('#/books/space')).toMatchObject({ view: 'books', spacesList: true });
  });

  it('旧的对话、消息里的 Plasticine、旁聊链接都到 Plasticine 栏目；书签和新标签页到网页', () => {
    expect(routeHash(parseHash('#/conversation'))).toBe('#/plasticine');
    expect(routeHash(parseHash('#/conversation/msg_9'))).toBe('#/plasticine/msg_9');
    expect(routeHash(parseHash('#/conversation/matters/m_1'))).toBe('#/plasticine');
    expect(routeHash(parseHash('#/messages/plasticine'))).toBe('#/plasticine');
    expect(routeHash(parseHash('#/messages/plasticine/msg_1'))).toBe('#/plasticine/msg_1');
    expect(routeHash(parseHash('#/messages/plasticine/side/l2'))).toBe('#/plasticine/side/l2');
    expect(routeHash(parseHash('#/bookmarks'))).toBe('#/web');
    expect(routeHash(parseHash('#/bookmarks/b1'))).toBe('#/web');
    expect(routeHash(parseHash('#/newtab'))).toBe('#/web');
  });

  it('旧的联系人和站内信链接打开消息里对应的人', () => {
    expect(parseHash('#/contacts')).toMatchObject({ view: 'messages', contactId: null });
    expect(parseHash('#/contacts/c_linyi')).toMatchObject({ view: 'messages', contactId: 'c_linyi' });
    expect(parseHash('#/contacts/c_linyi/profile')).toMatchObject({ view: 'messages', contactId: 'c_linyi',
      contactPane: 'profile' });
    expect(parseHash('#/contacts/requests')).toMatchObject({ view: 'messages', contactPane: 'requests' });
    expect(parseHash('#/inbox/inbox_demo_1')).toMatchObject({ view: 'messages', contactId: null });
    expect(routeHash({ view: 'contacts', noteId: null, contactId: 'c_linyi' })).toBe('#/messages/c_linyi');
    expect(navLabel('contacts')).toBe('消息');
  });

  it('图标栏三组：现在、Plasticine、消息、任务 ｜ 网页、信息流 ｜ 笔记、资料库', () => {
    expect(RAIL_GROUPS.map((group) => group.map((id) => SECTIONS[id].label)))
      .toEqual([['现在', 'Plasticine', '消息', '任务'], ['网页', '信息流'], ['笔记', '资料库']]);
  });

  it('每个地址归一个栏目：记忆在 Plasticine，项目和工作在任务，空间和图书在资料库', () => {
    const cases: [string, string][] = [['#/today', 'now'], ['#/plasticine', 'plasticine'], ['#/memory', 'plasticine'],
      ['#/messages/c1', 'messages'], ['#/tasks/timed', 'tasks'], ['#/projects/p1', 'tasks'], ['#/web/t1', 'web'],
      ['#/feed', 'feed'], ['#/notes/n1', 'notes'], ['#/books/space/s1', 'library'], ['#/books/b1', 'library'],
      ['#/tools/files', 'library']];
    for (const [hash, section] of cases) {
      expect(sectionOf(parseHash(hash))).toBe(section);
    }
  });

  it('手机底栏五格：现在 · Plasticine · 消息 · 笔记 · 更多；任务、信息流、图书、空间在「更多」里', () => {
    expect(PHONE_TABS).toEqual(['now', 'plasticine', 'messages', 'notes', 'more']);
    expect(MORE_ITEMS.map((item) => item.label)).toEqual(['任务', '信息流', '图书', '空间']);
    expect(phoneTabOf(parseHash('#/tasks'))).toBe('more');
    expect(phoneTabOf(parseHash('#/feed'))).toBe('more');
    expect(phoneTabOf(parseHash('#/memory'))).toBe('plasticine');
  });

  it('设置精简成六段（2026-11-05）：通用 · AI · 日常 · 浏览器与信息流 · 账号 · 系统；旧段名落到新段的对应处', () => {
    expect(SETTINGS_SECTIONS).toEqual(['general', 'ai', 'daily', 'browser', 'account', 'system']);
    expect(routeHash(parseHash('#/settings/browser'))).toBe('#/settings/browser');
    expect(parseHash('#/settings/feed')).toEqual({ view: 'settings', noteId: null, settingsSection: 'browser',
      settingsFocus: 'feed' });
    expect(parseHash('#/settings/network')).toEqual({ view: 'settings', noteId: null, settingsSection: 'account' });
    expect(parseHash('#/settings/visibility')).toEqual({ view: 'settings', noteId: null, settingsSection: 'account',
      settingsFocus: 'visibility' });
    expect(parseHash('#/settings/notices')).toEqual({ view: 'settings', noteId: null, settingsSection: 'account',
      settingsFocus: 'notices' });
    expect(parseHash('#/settings/nonsense')).toEqual({ view: 'settings', noteId: null });
  });
});
