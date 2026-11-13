// 把地上的小动物画出来：每只按自己的字号把 ASCII 画一行一行写出来（字挨着字，不按背景的格子拉开），
// 不贴格子，所以能平滑地走；身子底下的草不画（先占格）。头上冒的 ♥ ! ? z 往上飘、淡掉。

import { CRITTER_ART, mirrorFrame, type CritterKind, type Pose } from './critter-art.ts';
import { poseOf, type Critter } from './critters.ts';
import type { AmbientPalette } from './palette.ts';

/** 被小动物占着的格子（背景不画草、小东西不画）。 */
export const FLAG_CRITTER = 7;
const MOOD_LIFE = 1.6;

const mirrored = new Map<string, readonly string[]>();

function frameOf(c: Critter): readonly string[] {
  const pose: Pose = poseOf(c);
  const frames = CRITTER_ART[c.kind].frames[pose];
  const index = pose === 'walk'
    ? (c.kind === 'rabbit' ? (c.lift > 2 ? 1 : 0) : Math.floor(c.phase) % frames.length) : 0;
  const frame = frames[index] ?? frames[0]!;
  if (c.facing === 1) return frame;
  const key = `${c.kind}:${pose}:${index}`;
  let flipped = mirrored.get(key);
  if (flipped === undefined) {
    flipped = mirrorFrame(frame);
    mirrored.set(key, flipped);
  }
  return flipped;
}

interface Layout {
  frame: readonly string[];
  font: number;
  advance: number;
  line: number;
  left: number;
  top: number;
}

function layout(ctx: CanvasRenderingContext2D, c: Critter, ch: number, family: string): Layout {
  const frame = frameOf(c);
  const font = Math.round(ch * 1.3 * c.size);
  ctx.font = `600 ${font}px ${family}`;
  const advance = ctx.measureText('M').width;
  const line = ch * 1.32 * c.size;
  const width = Math.max(...frame.map((row) => row.length)) * advance;
  return { frame, font, advance, line, left: c.x - width / 2, top: c.y - c.lift - frame.length * line };
}

/** 先占格：小动物身子底下（每行从第一个字到最后一个字）不画草。 */
export function markCritters(ctx: CanvasRenderingContext2D, critters: readonly Critter[], flags: Uint8Array,
  grid: { cols: number; rows: number; cw: number; ch: number }, family: string): void {
  const { cols, rows, cw, ch } = grid;
  for (const c of critters) {
    const l = layout(ctx, c, ch, family);
    l.frame.forEach((row, r) => {
      const first = row.search(/\S/);
      if (first < 0) return;
      const last = row.trimEnd().length;
      const y0 = Math.floor((l.top + r * l.line) / ch);
      const y1 = Math.floor((l.top + (r + 1) * l.line - 1) / ch);
      const x0 = Math.floor((l.left + first * l.advance) / cw);
      const x1 = Math.floor((l.left + last * l.advance) / cw);
      for (let y = Math.max(0, y0); y <= Math.min(rows - 1, y1); y++) {
        for (let x = Math.max(0, x0); x <= Math.min(cols - 1, x1); x++) flags[y * cols + x] = FLAG_CRITTER;
      }
    });
  }
}

export function drawCritters(ctx: CanvasRenderingContext2D, critters: readonly Critter[], palette: AmbientPalette,
  fade: (x: number, y: number) => number, ch: number, family: string, t: number): void {
  const order = [...critters].sort((a, b) => a.y - b.y);
  for (const c of order) {
    const l = layout(ctx, c, ch, family);
    const colors = CRITTER_ART[c.kind as CritterKind].colors;
    // 每个字按它底下有没有正文压淡：只露半个身子在空地上时，压在字上的那半淡下去。
    l.frame.forEach((row, r) => {
      const y = l.top + r * l.line + l.line / 2;
      [...row].forEach((char, k) => {
        if (char === ' ') return;
        const x = l.left + k * l.advance + l.advance / 2;
        const tone = colors[char] ?? c.tone;
        ctx.fillStyle = palette.style(tone, (tone === c.tone ? 0.88 : 0.95) * fade(x, y));
        ctx.fillText(char, x, y);
      });
    });
    drawMood(ctx, c, l, palette, fade(c.x, l.top), t);
  }
}

function drawMood(ctx: CanvasRenderingContext2D, c: Critter, l: Layout, palette: AmbientPalette, quiet: number,
  t: number): void {
  if (c.mood === null) return;
  const age = t - c.mood.at;
  if (age < 0 || age > MOOD_LIFE) return;
  const rise = age * 14;
  const alpha = (1 - age / MOOD_LIFE) * quiet;
  const width = Math.max(...l.frame.map((row) => row.length)) * l.advance;
  const x = l.left + width * (c.facing === 1 ? 0.85 : 0.15) + (c.mood.glyph === 'z' ? age * 6 * c.facing : 0);
  const tone = c.mood.glyph === '♥' ? 'rose' : c.mood.glyph === '!' ? 'clay' : 'muted';
  ctx.fillStyle = palette.style(tone, alpha);
  ctx.fillText(c.mood.glyph, x, l.top - l.line * 0.4 - rise);
}
