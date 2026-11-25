import type { CSSProperties } from 'react';
import type { MateCharacter, MateFace, MateVariant, ProjectHue } from '../../../api/shared.ts';
import type { Engine } from './bot-engine.ts';
import { PLASTICINE_SHAPE, SWIRL_FACE } from './plasticine-face.ts';

export type BotLook = { kind: 'mate'; character: MateCharacter; hue: ProjectHue; variant: MateVariant; face: MateFace }
  | { kind: 'main'; variant: MateVariant };

const PAGE = 'var(--bg)';
const inkOf = (look: BotLook): string => (look.kind === 'main' ? 'var(--accent)' : `var(--hue-${look.hue})`);

export function liveColors(look: BotLook): CSSProperties {
  const colors: Record<string, string> = { '--plasticine-fg': inkOf(look), '--plasticine-eye': PAGE };
  if (look.kind === 'main') Object.assign(colors, { '--plasticine-face': PAGE, '--plasticine-face-soft': PAGE });
  return colors as CSSProperties;
}

export function engineShape(look: BotLook): { shape: string; face: string; variant: string } {
  return look.kind === 'main' ? { shape: PLASTICINE_SHAPE, face: SWIRL_FACE, variant: look.variant }
    : { shape: look.character, face: look.face, variant: look.variant };
}

export function recolorDrawnFace(svg: string): string {
  return svg.replace(/(<g data-plasticine-face="">)([\s\S]*?)(<\/g>)/, (_, open: string, body: string, close: string) =>
    open + body.replaceAll('fill="#FFFFFF"', `fill="${PAGE}"`) + close);
}

const cache = new Map<string, string>();
const CACHE_LIMIT = 400;

export function stillSvg(engine: Engine, look: BotLook, state: string, size: number): string {
  const { shape, face, variant } = engineShape(look);
  const key = `${shape}:${face}:${variant}:${look.kind === 'main' ? 'main' : look.hue}:${state}:${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const svg = engine.renderStaticSvg({ shape, face, variant, state, sizePx: size, ink: { flat: inkOf(look) },
    eyeColor: PAGE, colorScheme: 'page' });
  const done = (look.kind === 'main' ? recolorDrawnFace(svg) : svg).replace(/>\s+</g, '><').trim();
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value ?? '');
  cache.set(key, done);
  return done;
}
