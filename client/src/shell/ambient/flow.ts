// 水流（11-13 Aaron「一个没有主体，水流背景的 ASCII」）：一层被洋流扭弯的噪声往右流，取它的「脊」成一道道细长的水纹，
// 字是 ~ 和 -，水纹亮的地方偏青。鼠标在水面上搅起旋涡，点一下荡开一圈水波。

import { clamp, current, smoothstep, valueNoise } from './math.ts';
import type { AmbientPalette } from './palette.ts';

/** 往右流的速度（像素 / 秒）。 */
const DRIFT = 30;
/** 洋流把水纹扭弯的程度。 */
const WARP = 9;
const STIR_RADIUS = 140;
const RING_SPEED = 200;
const RING_LIFE = 1.8;

interface Ring {
  x: number;
  y: number;
  at: number;
}

export class FlowField {
  private cols = 0;
  private rows = 0;
  private cw = 10;
  private ch = 15;
  private rings: Ring[] = [];
  /** 鼠标搅出来的旋涡：慢慢跟上鼠标，移开后慢慢平息。 */
  private readonly stir = { x: 0, y: 0, strength: 0 };
  private readonly warp = { x: 0, y: 0 };

  resize(cols: number, rows: number, cw: number, ch: number): void {
    this.cols = cols;
    this.rows = rows;
    this.cw = cw;
    this.ch = ch;
  }

  splash(x: number, y: number, t: number): void {
    this.rings.push({ x, y, at: t });
  }

  step(dt: number, t: number, pointer: { x: number; y: number; active: boolean }): void {
    const stir = this.stir;
    if (pointer.active) {
      const follow = Math.min(1, dt * 5);
      stir.x += (pointer.x - stir.x) * follow;
      stir.y += (pointer.y - stir.y) * follow;
      stir.strength += (1 - stir.strength) * Math.min(1, dt * 2);
    } else {
      stir.strength *= Math.exp(-dt * 1.2);
    }
    this.rings = this.rings.filter((ring) => t - ring.at < RING_LIFE);
  }

  draw(ctx: CanvasRenderingContext2D, palette: AmbientPalette, quiet: Float32Array, t: number): void {
    const { cols, rows, cw, ch } = this;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = col * cw + cw / 2;
        const cy = row * ch + ch / 2;
        let e = this.ridge(cx, cy, t) + this.ringAt(cx, cy, t);
        if (e < 0.16) continue;
        e = Math.min(1, e);
        ctx.fillStyle = palette.style(e > 0.8 ? 'teal' : 'sky', clamp(e * 0.85, 0.1, 0.8) * quiet[row * cols + col]!);
        ctx.fillText(e > 0.55 ? '~' : '-', cx, cy + 1);
      }
    }
  }

  /** 这一点的水纹有多亮：鼠标附近先绕着它转一个角度（越近转得越多），再取扭弯后的噪声的「脊」。 */
  private ridge(px: number, py: number, t: number): number {
    const stir = this.stir;
    let x = px;
    let y = py;
    if (stir.strength > 0.02) {
      const dx = x - stir.x;
      const dy = y - stir.y;
      const d = Math.hypot(dx, dy);
      if (d < STIR_RADIUS) {
        const turn = stir.strength * 2.4 * (1 - d / STIR_RADIUS) ** 2;
        x = stir.x + dx * Math.cos(turn) - dy * Math.sin(turn);
        y = stir.y + dx * Math.sin(turn) + dy * Math.cos(turn);
      }
    }
    current(x, y, t, this.warp);
    const u = (x - t * DRIFT + this.warp.x * WARP) / 130;
    const v = (y + this.warp.y * WARP) / 34;
    // 两层细长的「脊」叠在一起：一道道弯弯的水纹，粗细不一。
    const a = valueNoise(u, v, 3) * 0.75 + valueNoise(u * 2.3 - t * 0.12, v * 2.3, 4) * 0.25;
    const b = valueNoise(u * 0.6 + 7.3, v * 1.4 - t * 0.05, 5);
    const ridgeA = smoothstep(0.85, 0.985, 1 - Math.abs(2 * a - 1));
    const ridges = Math.max(ridgeA, smoothstep(0.9, 0.99, 1 - Math.abs(2 * b - 1)) * 0.75);
    // 大片大片的：有的地方水纹密，有的地方平静，跟着水慢慢漂。
    const patch = smoothstep(0.32, 0.68, valueNoise((px - t * DRIFT * 0.6) / 420, py / 300, 6));
    return ridges * (0.25 + 0.75 * patch);
  }

  /** 点一下荡开的水波：一圈往外走、越走越淡。 */
  private ringAt(x: number, y: number, t: number): number {
    let e = 0;
    for (const ring of this.rings) {
      const age = t - ring.at;
      const edge = Math.abs(Math.hypot(x - ring.x, y - ring.y) - age * RING_SPEED);
      if (edge < 18) e += (1 - edge / 18) * (1 - age / RING_LIFE) * 0.9;
    }
    return e;
  }
}
