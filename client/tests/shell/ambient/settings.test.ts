// 动态背景的设置（11-13 Aaron）：坏的、缺的回默认，速度和透明度夹在范围里，九页各自开关；地址归到哪一页。

import { describe, expect, it } from 'vitest';
import { AMBIENT_PAGES, ambientPageOf, DEFAULT_AMBIENT, OPACITY_RANGE, parseAmbient,
  SPEED_RANGE } from '../../../src/shell/ambient/settings.ts';
import { FIGURE_IDS } from '../../../src/shell/ambient/figures.ts';
import { mainLineRoute, messagesRoute, skillsRoute, webRoute } from '../../../src/shell/routes.ts';

describe('动态背景 · 存着的设置', () => {
  it('没存过、存坏了：默认开着、鲨鱼、原速、60%、九页都开', () => {
    for (const raw of [null, '', '{', '[]', '"x"']) {
      expect(parseAmbient(raw)).toEqual(DEFAULT_AMBIENT);
    }
    expect(DEFAULT_AMBIENT).toMatchObject({ enabled: true, figure: 'shark', speed: 1, opacity: 0.6 });
    expect(AMBIENT_PAGES.every((page) => DEFAULT_AMBIENT.pages[page])).toBe(true);
  });

  it('一项坏了只那一项回默认；速度、透明度夹在范围里；不认识的形象回鲨鱼', () => {
    const parsed = parseAmbient(JSON.stringify({ enabled: false, figure: 'unicorn', speed: 9, opacity: -1,
      pages: { notes: false, skills: 'no' } }));
    expect(parsed.enabled).toBe(false);
    expect(parsed.figure).toBe('shark');
    expect(parsed.speed).toBe(SPEED_RANGE.max);
    expect(parsed.opacity).toBe(OPACITY_RANGE.min);
    expect(parsed.pages.notes).toBe(false);
    expect(parsed.pages.skills).toBe(true);
    expect(parsed.pages.now).toBe(true);
    expect(parseAmbient(JSON.stringify({ figure: 'cat', speed: 'fast' }))).toMatchObject({ figure: 'cat', speed: 1 });
    expect(parseAmbient(JSON.stringify({ figure: 'dragon' })).figure).toBe('shark');
  });

  it('十一个形象，id 不重复；没有蜈蚣、飞龙、游蛇、数据蛇（11-13 Aaron：让人不太舒服的去掉）', () => {
    expect(FIGURE_IDS).toHaveLength(11);
    expect(new Set(FIGURE_IDS).size).toBe(11);
    expect(FIGURE_IDS).toEqual(expect.arrayContaining(['rabbit', 'fox', 'dog', 'cat', 'water']));
    for (const gone of ['centipede', 'dragon', 'snake', 'serpent']) expect(FIGURE_IDS).not.toContain(gone);
  });
});

describe('动态背景 · 地址算哪一页', () => {
  it('Plasticine 栏里的主线、记忆算「对话」，技能单独一页，其余跟着栏目', () => {
    expect(ambientPageOf(mainLineRoute())).toBe('chat');
    expect(ambientPageOf({ view: 'memory', noteId: null })).toBe('chat');
    expect(ambientPageOf(skillsRoute())).toBe('skills');
    expect(ambientPageOf({ view: 'today', noteId: null })).toBe('now');
    expect(ambientPageOf(messagesRoute(null))).toBe('messages');
    expect(ambientPageOf({ view: 'tasks', noteId: null, tasksSection: 'run' })).toBe('tasks');
    expect(ambientPageOf(webRoute(null))).toBe('web');
    expect(ambientPageOf({ view: 'feed', noteId: null })).toBe('reading');
    expect(ambientPageOf({ view: 'notes', noteId: null })).toBe('notes');
    expect(ambientPageOf({ view: 'library', noteId: null })).toBe('library');
  });
});
