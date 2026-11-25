import type { SpaceListItem } from '../../api/shared.ts';

const CATEGORY_NAMES = { webarchive: '网页归档', booknote: '图书笔记', report: '报告', letter: '来信', space: '空间' };
type Category = keyof typeof CATEGORY_NAMES;
const ORDER: Category[] = ['webarchive', 'booknote', 'report', 'letter', 'space'];

function categoryOf(space: Pick<SpaceListItem, 'category' | 'genre'>): Category {
  return space.category ?? space.genre ?? 'space';
}
export function spaceCategoryLabel(space: Pick<SpaceListItem, 'category' | 'genre'>): string {
  return CATEGORY_NAMES[categoryOf(space)];
}
export function groupSpaces(spaces: readonly SpaceListItem[]) {
  return ORDER.map((category) => ({ category, label: CATEGORY_NAMES[category],
    spaces: spaces.filter((space) => categoryOf(space) === category) })).filter((group) => group.spaces.length > 0);
}
