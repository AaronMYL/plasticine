// 动态背景能选的形象（11-13 Aaron：鲨鱼能换成别的；除了鲨鱼还要赛博、海里的、地上的、天上的）。
// 一个形象 = 几个大家伙（追的）+ 一群小东西（被追的）+ 一种底（海里的水纹、天上的云、地上的草、赛博的数据雨）。

import type { BodyId } from './bodies.ts';
import type { CritterSpec } from './critters.ts';
import type { PreyKind } from './prey.ts';

export const AMBIENT_GROUPS = ['sea', 'sky', 'land', 'cyber'] as const;
export type AmbientGroup = (typeof AMBIENT_GROUPS)[number];

export const GROUP_LABELS: Readonly<Record<AmbientGroup, string>> = {
  sea: '海里', sky: '天上', land: '地上', cyber: '赛博',
};

/** 每一组的小东西：海里是鱼，天上是鸟，地上是虫，赛博里是数据包。 */
export const GROUP_PREY: Readonly<Record<AmbientGroup, PreyKind>> = {
  sea: 'fish', sky: 'birds', land: 'bugs', cyber: 'bits',
};

export interface CreatureSpec {
  body: BodyId;
  /** 相对最大那一只的大小（也当远近用：小的远、淡）。 */
  size: number;
}

export interface Figure {
  id: string;
  label: string;
  group: AmbientGroup;
  creatures: readonly CreatureSpec[];
  /** 地上的小动物。 */
  critters?: readonly CritterSpec[];
  /** 只有水流，没有别的（11-13 Aaron「一个没有主体，水流背景的」）。 */
  flow?: true;
}

export const FIGURES = [
  { id: 'shark', label: '鲨鱼', group: 'sea', creatures: [
    { body: 'shark', size: 1 }, { body: 'shark', size: 0.7 }, { body: 'shark', size: 0.84 },
    { body: 'shark', size: 0.77 }] },
  { id: 'hammerhead', label: '锤头鲨', group: 'sea', creatures: [
    { body: 'greatHammer', size: 1 }, { body: 'hammerhead', size: 0.8 }, { body: 'hammerhead', size: 0.72 }] },
  { id: 'whale', label: '鲸鱼', group: 'sea', creatures: [{ body: 'whale', size: 1 }, { body: 'whale', size: 0.6 }] },
  { id: 'manta', label: '蝠鲼', group: 'sea', creatures: [
    { body: 'manta', size: 1 }, { body: 'manta', size: 0.82 }, { body: 'manta', size: 0.7 }] },
  { id: 'water', label: '水流', group: 'sea', creatures: [], flow: true },
  { id: 'hawk', label: '老鹰', group: 'sky', creatures: [{ body: 'hawk', size: 1 }, { body: 'hawk', size: 0.84 }] },
  { id: 'rabbit', label: '兔子', group: 'land', creatures: [], critters: [
    { kind: 'rabbit', size: 1, tone: 'muted' }, { kind: 'rabbit', size: 0.9, tone: 'ink' },
    { kind: 'rabbit', size: 0.85, tone: 'ochre' }, { kind: 'rabbit', size: 0.8, tone: 'muted' }] },
  { id: 'fox', label: '狐狸', group: 'land', creatures: [], critters: [
    { kind: 'fox', size: 1, tone: 'clay' }, { kind: 'fox', size: 0.85, tone: 'ochre' }] },
  { id: 'dog', label: '小狗', group: 'land', creatures: [], critters: [
    { kind: 'dog', size: 1, tone: 'ochre' }, { kind: 'dog', size: 0.9, tone: 'ink' },
    { kind: 'dog', size: 0.82, tone: 'clay' }] },
  { id: 'cat', label: '猫咪', group: 'land', creatures: [], critters: [
    { kind: 'cat', size: 1, tone: 'ink' }, { kind: 'cat', size: 0.9, tone: 'ochre' },
    { kind: 'cat', size: 0.85, tone: 'slate' }] },
  { id: 'mech', label: '机械鲨', group: 'cyber', creatures: [
    { body: 'mech', size: 1 }, { body: 'mech', size: 0.78 }, { body: 'mech', size: 0.86 }] },
] as const satisfies readonly Figure[];

export type FigureId = (typeof FIGURES)[number]['id'];
export const FIGURE_IDS: readonly FigureId[] = FIGURES.map((figure) => figure.id);
export const DEFAULT_FIGURE: FigureId = 'shark';

export function figureById(id: string): Figure {
  return FIGURES.find((figure) => figure.id === id) ?? FIGURES[0];
}
