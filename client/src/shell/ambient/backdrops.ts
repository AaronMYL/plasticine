// 四种底：海里是稀疏的水点和游过留下的水纹，天上是被风吹着走的云，地上是随风摆的草，赛博是数据雨。
// 都画在大家伙和小东西下面；有东西压着的格子不画，鼠标、游过去的身体会搅动它们（水纹亮、云散开、草倒下、雨让开）。

import type { AmbientGroup } from './figures.ts';
import { clamp, hash3, valueNoise } from './math.ts';
import type { AmbientPalette } from './palette.ts';

export interface BackdropFrame {
  ctx: CanvasRenderingContext2D;
  cols: number;
  rows: number;
  cw: number;
  ch: number;
  t: number;
  /** 水纹场：游过的地方、鼠标划过的地方变大，慢慢散开、淡掉。 */
  energy: Float32Array;
  /** 这一格有大家伙压着（非 0）。 */
  occupied: Uint8Array;
  /** 正文那一块压淡的倍数。 */
  quiet: Float32Array;
  palette: AmbientPalette;
  pointer: { x: number; y: number; active: boolean };
}

export function drawBackdrop(group: AmbientGroup, f: BackdropFrame): void {
  switch (group) {
    case 'sea':
      return drawSea(f);
    case 'sky':
      return drawSky(f);
    case 'land':
      return drawGrass(f);
    case 'cyber':
      return drawRain(f);
  }
}

function glyph(f: BackdropFrame, i: number, char: string): void {
  const col = i % f.cols;
  const row = (i / f.cols) | 0;
  f.ctx.fillText(char, col * f.cw + f.cw / 2, row * f.ch + f.ch / 2 + 1);
}

/** 九格里一个水点，随两道慢慢移动的光带明暗；水纹强的地方亮成大一点的点。 */
function drawSea(f: BackdropFrame): void {
  const { ctx, cols, rows, cw, ch, t, energy, occupied, quiet, palette } = f;
  const small = Math.max(2, Math.round(cw * 0.19));
  for (let i = 0; i < cols * rows; i++) {
    if (occupied[i]) continue;
    const col = i % cols;
    const row = (i / cols) | 0;
    const e = energy[i]!;
    let alpha: number;
    let size = small;
    if (e > 0.45) {
      alpha = clamp(0.25 + (e - 0.45) * 0.9, 0.25, 0.85);
      size = small + 1;
    } else {
      if (hash3(col, row, 23) > 0.11) continue;
      const twinkle = 0.5 + 0.5 * Math.sin(t * (0.3 + hash3(col, row, 37) * 1.1) + hash3(col, row, 29) * 6.28);
      const caustic = 0.8 + 0.2 * Math.sin(col * 0.11 + t * 0.35) * Math.sin(row * 0.17 - t * 0.27);
      alpha = (0.12 + 0.16 * twinkle) * caustic + e * 0.4;
    }
    ctx.fillStyle = palette.style('sky', alpha * quiet[i]!);
    ctx.fillRect(Math.round(col * cw + cw * 0.66 - size / 2), Math.round(row * ch + ch * 0.64 - size / 2), size, size);
  }
}

const CLOUD = '.:;~';

/** 两层噪声叠出的云往右飘；搅动的地方云变薄、留下一道风痕。 */
function drawSky(f: BackdropFrame): void {
  const { ctx, cols, rows, t, energy, occupied, quiet, palette } = f;
  const drift = t * 0.55;
  for (let i = 0; i < cols * rows; i++) {
    if (occupied[i]) continue;
    const col = i % cols;
    const row = (i / cols) | 0;
    const e = energy[i]!;
    const n = valueNoise((col - drift) / 16, row / 6.5, 11) * 0.65
      + valueNoise((col - drift * 1.6) / 7, row / 3.2, 12) * 0.35 - e * 0.35;
    if (n < 0.56) {
      if (e > 0.5) {
        ctx.fillStyle = palette.style('sky', clamp((e - 0.5) * 0.8, 0.1, 0.5) * quiet[i]!);
        glyph(f, i, '~');
      }
      continue;
    }
    // 每格抖一点，云不会排成一行一行的。
    const d = clamp((n - 0.56) / 0.3 + (hash3(col, row, 13) - 0.5) * 0.45, 0, 0.999);
    if (d < 0.08 && hash3(col, row, 17) < 0.5) continue;
    ctx.fillStyle = palette.style('faint', (0.1 + 0.26 * d) * quiet[i]!);
    glyph(f, i, CLOUD[Math.floor(d * CLOUD.length)]!);
  }
}

/** 一簇簇草随风一波一波地倒；鼠标附近往外倒，被压过的地方伏下去，偶尔一朵花。 */
function drawGrass(f: BackdropFrame): void {
  const { ctx, cols, rows, cw, ch, t, energy, occupied, quiet, palette, pointer } = f;
  for (let i = 0; i < cols * rows; i++) {
    if (occupied[i]) continue;
    const col = i % cols;
    const row = (i / cols) | 0;
    // 一片一片的草地：噪声高的地方密，别处稀稀拉拉。
    const meadow = valueNoise(col / 14, row / 9, 7);
    if (hash3(col, row, 5) > 0.06 + 0.34 * meadow * meadow) continue;
    const kind = hash3(col, row, 9);
    const q = quiet[i]!;
    if (kind < 0.014) {
      ctx.fillStyle = palette.style(kind < 0.007 ? 'ochre' : 'rose', 0.45 * q);
      glyph(f, i, '*');
      continue;
    }
    const e = energy[i]!;
    const gust = valueNoise(col / 18 - t * 0.25, row / 9, 3);
    let bend = Math.sin(col * 0.21 - t * 1.4 + row * 0.07) * (0.3 + 0.7 * gust);
    if (pointer.active) {
      const dx = col * cw + cw / 2 - pointer.x;
      const dy = row * ch + ch / 2 - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < 90) bend += Math.sign(dx) * (1 - d / 90) * 1.4;
    }
    let char: string;
    if (e > 0.55) char = e > 0.95 ? '_' : '.';
    else if (kind < 0.8) char = bend < -0.3 ? '`' : bend > 0.3 ? ',' : "'";
    else char = bend < -0.4 ? '\\' : bend > 0.4 ? '/' : '|';
    ctx.fillStyle = palette.style('sage', (0.16 + 0.2 * kind) * q);
    glyph(f, i, char);
  }
}

const RAIN = '01<>/\\{}[]=+*:;ABCDEF';

/** 一列一列往下落的字，头亮尾淡；鼠标经过的地方让开，水纹的地方亮一下。 */
function drawRain(f: BackdropFrame): void {
  const { ctx, cols, rows, cw, ch, t, energy, occupied, quiet, palette, pointer } = f;
  for (let col = 0; col < cols; col++) {
    if (hash3(col, 0, 41) > 0.42) continue;
    const speed = 4 + hash3(col, 1, 41) * 10;
    const trail = 6 + Math.floor(hash3(col, 2, 41) * 14);
    const cycle = rows + trail + 12;
    const head = Math.floor((t * speed + hash3(col, 3, 41) * cycle) % cycle);
    for (let d = 0; d < trail; d++) {
      const row = head - d;
      if (row < 0 || row >= rows) continue;
      const i = row * cols + col;
      if (occupied[i]) continue;
      if (pointer.active && Math.hypot(col * cw + cw / 2 - pointer.x, row * ch + ch / 2 - pointer.y) < 64) continue;
      const alpha = d === 0 ? 0.55 : (1 - d / trail) * 0.3;
      ctx.fillStyle = palette.style('teal', alpha * quiet[i]!);
      glyph(f, i, RAIN[Math.floor(hash3(col, row, Math.floor(t * 6) + d) * RAIN.length)]!);
    }
  }
  for (let i = 0; i < cols * rows; i++) {
    const e = energy[i]!;
    if (e < 0.5 || occupied[i]) continue;
    ctx.fillStyle = palette.style('teal', clamp((e - 0.5) * 0.9, 0.12, 0.6) * quiet[i]!);
    glyph(f, i, '.');
  }
}
