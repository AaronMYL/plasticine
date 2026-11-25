import { describe, expect, it } from 'vitest';
import { AMBIENT_PAGES, ambientPageOf, DEFAULT_AMBIENT, OPACITY_RANGE, parseAmbient,
  SPEED_RANGE } from '../../../src/shell/ambient/settings.ts';
import { FIGURE_IDS } from '../../../src/shell/ambient/figures.ts';
import { mainLineRoute, messagesRoute, skillsRoute, webRoute } from '../../../src/shell/routes.ts';

describe('live background: persisted settings', () => {
  it('missing or corrupt storage defaults to enabled, shark, 1x speed, 60%, all 9 pages on', () => {
    for (const raw of [null, '', '{', '[]', '"x"']) {
      expect(parseAmbient(raw)).toEqual(DEFAULT_AMBIENT);
    }
    expect(DEFAULT_AMBIENT).toMatchObject({ enabled: true, figure: 'shark', speed: 1, opacity: 0.6 });
    expect(AMBIENT_PAGES.every((page) => DEFAULT_AMBIENT.pages[page])).toBe(true);
  });

  it('corrupt single field falls back alone; clamps speed/opacity; unknown creature falls back', () => {
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

  it('11 unique creatures exclude centipede, dragon, water snake, and data snake', () => {
    expect(FIGURE_IDS).toHaveLength(11);
    expect(new Set(FIGURE_IDS).size).toBe(11);
    expect(FIGURE_IDS).toEqual(expect.arrayContaining(['rabbit', 'fox', 'dog', 'cat', 'water']));
    for (const gone of ['centipede', 'dragon', 'snake', 'serpent']) expect(FIGURE_IDS).not.toContain(gone);
  });
});

describe('live background: route-to-page mapping', () => {
  it('main thread and memory map to chat, skills has its own page, others follow section', () => {
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
