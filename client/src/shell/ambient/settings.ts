// 动态背景的设置（11-13 Aaron）：可以整个关掉，也可以一页一页关（首页、对话、消息、任务、网页、阅读、笔记、资料库、技能）；
// 形象、速度、透明度可调。和「外观」一样只在这台设备记住（localStorage），别的窗口改了这里跟着变。

import { sectionOf } from '../sections.ts';
import type { Route } from '../routes.ts';
import { Store } from '../../state/store.ts';
import { DEFAULT_FIGURE, FIGURE_IDS, type FigureId } from './figures.ts';

export const AMBIENT_PAGES = [
  'now', 'chat', 'messages', 'tasks', 'web', 'reading', 'notes', 'library', 'skills',
] as const;
export type AmbientPage = (typeof AMBIENT_PAGES)[number];

export const AMBIENT_PAGE_LABELS: Readonly<Record<AmbientPage, string>> = {
  now: '首页', chat: '对话', messages: '消息', tasks: '任务', web: '网页', reading: '阅读', notes: '笔记',
  library: '资料库', skills: '技能',
};

export const SPEED_RANGE = { min: 0.25, max: 2, step: 0.05 } as const;
export const OPACITY_RANGE = { min: 0.1, max: 1, step: 0.05 } as const;

export interface AmbientSettings {
  enabled: boolean;
  figure: FigureId;
  /** 1 是原速。 */
  speed: number;
  /** 整层的不透明度（0.1–1）；正文后面再自动压淡。 */
  opacity: number;
  pages: Readonly<Record<AmbientPage, boolean>>;
}

const ALL_PAGES = Object.fromEntries(AMBIENT_PAGES.map((page) => [page, true])) as Record<AmbientPage, boolean>;

export const DEFAULT_AMBIENT: AmbientSettings = {
  enabled: true, figure: DEFAULT_FIGURE, speed: 1, opacity: 0.6, pages: ALL_PAGES,
};

const KEY = 'plasticine.ambient';

const inRange = (value: unknown, range: { min: number; max: number }, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(range.max, Math.max(range.min, value)) : fallback;

/** 读存着的设置：缺的、坏的、不认识的都回默认，不因为一项坏了整个丢掉。 */
export function parseAmbient(raw: string | null): AmbientSettings {
  let value: unknown = null;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    value = null;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_AMBIENT;
  const record = value as Record<string, unknown>;
  const pages = typeof record['pages'] === 'object' && record['pages'] !== null
    ? record['pages'] as Record<string, unknown> : {};
  const figure = FIGURE_IDS.find((id) => id === record['figure']) ?? DEFAULT_AMBIENT.figure;
  return {
    enabled: typeof record['enabled'] === 'boolean' ? record['enabled'] : DEFAULT_AMBIENT.enabled,
    figure,
    speed: inRange(record['speed'], SPEED_RANGE, DEFAULT_AMBIENT.speed),
    opacity: inRange(record['opacity'], OPACITY_RANGE, DEFAULT_AMBIENT.opacity),
    pages: Object.fromEntries(AMBIENT_PAGES.map((page) => [page, pages[page] !== false])) as Record<AmbientPage,
      boolean>,
  };
}

function load(): AmbientSettings {
  try {
    return parseAmbient(localStorage.getItem(KEY));
  } catch {
    // 存储读不了（隐私模式等）：用默认值，照样能在这一次里调。
    return DEFAULT_AMBIENT;
  }
}

export const ambientStore = new Store<AmbientSettings>(load());

export function saveAmbient(change: Partial<AmbientSettings>): void {
  const next = { ...ambientStore.get(), ...change };
  ambientStore.set(next);
  localStorage.setItem(KEY, JSON.stringify(next));
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) ambientStore.set(parseAmbient(event.newValue));
  });
}

/** 这个地址算设置里的哪一页：技能单独一项，记忆跟着对话（都在 Plasticine 栏里）。 */
export function ambientPageOf(route: Route): AmbientPage {
  if (route.view === 'skills') return 'skills';
  const section = sectionOf(route);
  return section === 'plasticine' ? 'chat' : section;
}
