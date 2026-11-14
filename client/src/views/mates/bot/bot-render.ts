// 头像怎么画（11-13）：队友是 Plasticine-bot 的角色，身体是八色之一，画风、脸型可以换；萌脸、豆豆眼、线描脸的眼睛是
// 页面底色，别的脸型用引擎自己的眼白和眼珠。主线是泥团加漩涡，身体是强调色、漩涡是页面底色（和 Plasticine 图标一样，
// 深浅主题都跟着令牌走），画风可以换。静止的画成一段 SVG 字缓存起来；动的由引擎挂在元素上，颜色从元素上的变量读。

import type { CSSProperties } from 'react';
import type { MateCharacter, MateFace, MateVariant, ProjectHue } from '../../../api/shared.ts';
import type { Engine } from './bot-engine.ts';
import { PLASTICINE_SHAPE, SWIRL_FACE } from './plasticine-face.ts';

export type BotLook = { kind: 'mate'; character: MateCharacter; hue: ProjectHue; variant: MateVariant; face: MateFace }
  | { kind: 'main'; variant: MateVariant };

const PAGE = 'var(--bg)';
const inkOf = (look: BotLook): string => (look.kind === 'main' ? 'var(--accent)' : `var(--hue-${look.hue})`);

/** 动的头像挂在这个元素上：引擎读这几个变量上色。 */
export function liveColors(look: BotLook): CSSProperties {
  // 漩涡用脸色画，跟页面底色；队友别的脸型的眼白、眼珠用引擎默认的，和静止那张一样。
  const colors: Record<string, string> = { '--plasticine-fg': inkOf(look), '--plasticine-eye': PAGE };
  if (look.kind === 'main') Object.assign(colors, { '--plasticine-face': PAGE, '--plasticine-face-soft': PAGE });
  return colors as CSSProperties;
}

export function engineShape(look: BotLook): { shape: string; face: string; variant: string } {
  return look.kind === 'main' ? { shape: PLASTICINE_SHAPE, face: SWIRL_FACE, variant: look.variant }
    : { shape: look.character, face: look.face, variant: look.variant };
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

/** 静止的一张：同样的角色、颜色、画风、脸型、状态、大小只画一次。 */
export function stillSvg(engine: Engine, look: BotLook, state: string, size: number): string {
  const { shape, face, variant } = engineShape(look);
  const key = `${shape}:${face}:${variant}:${look.kind === 'main' ? 'main' : look.hue}:${state}:${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const svg = engine.renderStaticSvg({ shape, face, variant, state, sizePx: size, ink: { flat: inkOf(look) },
    eyeColor: PAGE, colorScheme: 'page' });
  // 标签之间的换行缩进去掉：头像放在带字的按钮里（手机底栏）时不给按钮的字多出空白。
  const done = (look.kind === 'main' ? recolorDrawnFace(svg) : svg).replace(/>\s+</g, '><').trim();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? '');
  cache.set(key, done);
  return done;
}
