// 头像怎么画（11-13）：队友是 Plasticine-bot 的角色，身体是八色之一、眼睛是页面底色；主线是泥团加漩涡，身体是
// 强调色、漩涡是页面底色（和 Plasticine 图标一样，深浅主题都跟着令牌走）。静止的画成一段 SVG 字缓存起来；
// 动的由引擎挂在元素上，颜色从元素上的变量读。

import type { CSSProperties } from 'react';
import type { MateCharacter, ProjectHue } from '../../../api/shared.ts';
import type { Engine } from './bot-engine.ts';
import { PLASTICINE_SHAPE, SWIRL_FACE } from './plasticine-face.ts';

export type BotLook = { kind: 'mate'; character: MateCharacter; hue: ProjectHue } | { kind: 'main' };

const PAGE = 'var(--bg)';
const inkOf = (look: BotLook): string => (look.kind === 'main' ? 'var(--accent)' : `var(--hue-${look.hue})`);

/** 动的头像挂在这个元素上：引擎读这几个变量上色。 */
export function liveColors(look: BotLook): CSSProperties {
  return { '--plasticine-fg': inkOf(look), '--plasticine-face': PAGE, '--plasticine-eye': PAGE,
    '--plasticine-face-soft': PAGE } as CSSProperties;
}

export function engineShape(look: BotLook): { shape: string; face: string } {
  return look.kind === 'main' ? { shape: PLASTICINE_SHAPE, face: SWIRL_FACE } : { shape: look.character, face: 'cute' };
}

/**
 * 漩涡脸是引擎的「画出来的脸」，静止输出里它的颜色写死成白色（只有可爱脸能换眼睛颜色）：换成页面底色，深色主题下
 * 和图标一样是深色的线。只动脸那一组里的填色。
 */
export function recolorDrawnFace(svg: string): string {
  return svg.replace(/(<g data-plasticine-face="">)([\s\S]*?)(<\/g>)/, (_, open: string, body: string, close: string) =>
    open + body.replaceAll('fill="#FFFFFF"', `fill="${PAGE}"`) + close);
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 400;

/** 静止的一张：同样的角色、颜色、状态、大小只画一次。 */
export function stillSvg(engine: Engine, look: BotLook, state: string, size: number): string {
  const key = `${look.kind === 'main' ? 'main' : `${look.character}:${look.hue}`}:${state}:${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const { shape, face } = engineShape(look);
  const svg = engine.renderStaticSvg({ shape, face, state, sizePx: size, ink: { flat: inkOf(look) },
    eyeColor: PAGE, colorScheme: 'page' });
  const done = look.kind === 'main' ? recolorDrawnFace(svg) : svg;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? '');
  cache.set(key, done);
  return done;
}
