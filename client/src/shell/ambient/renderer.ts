// 把模拟画成一格一格的字（透明底，叠在页面底色上）：先画底（水点 / 云 / 草 / 数据雨），再画小东西，最后画大家伙。
// 水纹场和「吃掉」的小火花照 ascii-sharks 的 renderer.ts（MIT，见 NOTICE.md）；颜色全部来自页面令牌。

import { drawBackdrop } from './backdrops.ts';
import { drawCritters, FLAG_CRITTER, markCritters } from './critter-draw.ts';
import type { AmbientGroup, Figure } from './figures.ts';
import { FlowField } from './flow.ts';
import { clamp, hash3 } from './math.ts';
import type { AmbientPalette } from './palette.ts';
import { CreatureRaster, FLAG_EDGE, FLAG_EYE, FLAG_FIN, FLAG_MARK, FLAG_RIDGE } from './raster.ts';
import type { QuietRect, World } from './world.ts';

/** 字后面压到多淡。 */
const QUIET_DIM = 0.14;
/** 字的边上过渡几格。 */
const QUIET_FEATHER = 2;
/** 身体底下那层淡底的浓度。 */
const BODY_FILL = 0.08;

export class AsciiRenderer {
  readonly raster = new CreatureRaster();
  private group: AmbientGroup = 'sea';
  /** 只有水流的那个形象。 */
  private flow: FlowField | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private palette: AmbientPalette;
  private fontFamily = 'ui-monospace, Menlo, monospace';
  private dpr = 1;
  private width = 0;
  private height = 0;
  private cw = 10;
  private ch = 15;
  private cols = 0;
  private rows = 0;
  private energy = new Float32Array(0);
  private energyTmp = new Float32Array(0);
  private heat = new Float32Array(0);
  private quiet = new Float32Array(0);
  private quietRects: readonly QuietRect[] = [];
  private moteStamp = new Uint32Array(0);
  private frameId = 0;

  constructor(canvas: HTMLCanvasElement, palette: AmbientPalette) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = palette;
  }

  get cellWidth(): number {
    return this.cw;
  }

  get cellHeight(): number {
    return this.ch;
  }

  setFontFamily(family: string): void {
    if (family) this.fontFamily = family;
  }

  setFigure(figure: Figure): void {
    this.group = figure.group;
    this.flow = figure.flow === true ? new FlowField() : null;
    this.flow?.resize(this.cols, this.rows, this.cw, this.ch);
  }

  setPalette(palette: AmbientPalette): void {
    this.palette = palette;
  }

  /** 字在哪（canvas 坐标，一行一个框）。 */
  setQuiet(rects: readonly QuietRect[]): void {
    this.quietRects = rects;
    this.buildQuiet();
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124), 8, 13);
    this.ch = Math.round(this.cw * 1.45);
    const cols = Math.ceil(width / this.cw);
    const rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (cols !== this.cols || rows !== this.rows) {
      const n = cols * rows;
      this.energy = new Float32Array(n);
      this.energyTmp = new Float32Array(n);
      this.heat = new Float32Array(n);
      this.quiet = new Float32Array(n);
      this.moteStamp = new Uint32Array(n);
    }
    this.cols = cols;
    this.rows = rows;
    this.raster.resize(cols, rows, this.cw, this.ch);
    this.flow?.resize(cols, rows, this.cw, this.ch);
    this.buildQuiet();
  }

  render(world: World, dt: number): void {
    const { ctx, dpr, cols, rows, cw, ch } = this;
    if (cols === 0) return;
    const t = world.time;
    this.consumeEvents(world);
    this.raster.rasterize(world.creatures, t);
    if (world.critters.length > 0) {
      markCritters(ctx, world.critters, this.raster.flag, { cols, rows, cw, ch }, this.fontFamily);
    }
    this.depositWake(world);
    this.diffuse(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (this.flow !== null) {
      this.flow.step(dt, t, world.pointer);
      this.flow.draw(ctx, this.palette, this.quiet, t);
    } else {
      drawBackdrop(this.group, {
        ctx, cols, rows, cw, ch, t, energy: this.energy, occupied: this.raster.flag, quiet: this.quiet,
        palette: this.palette, pointer: world.pointer,
      });
    }
    this.drawHeat(world);
    this.drawMotes(world);
    if (world.critters.length > 0) {
      const fade = (x: number, y: number): number => {
        const i = this.cellIndex(x, y);
        return i < 0 ? 1 : this.quiet[i]!;
      };
      drawCritters(ctx, world.critters, this.palette, fade, ch, this.fontFamily, t);
      ctx.font = font;
    }
    this.drawCreatures(world, t);
  }

  /** 字压着的格子最淡，往外两格慢慢恢复（先标格子，再做两遍距离扩散）。 */
  private buildQuiet(): void {
    const { cols, rows, cw, ch, quiet } = this;
    const n = cols * rows;
    if (n === 0) return;
    const far = QUIET_FEATHER + 1;
    const dist = new Uint8Array(n).fill(far);
    for (const q of this.quietRects) {
      const c0 = Math.max(0, Math.floor((q.x - 2) / cw));
      const c1 = Math.min(cols - 1, Math.floor((q.x + q.w + 2) / cw));
      const r0 = Math.max(0, Math.floor((q.y - 2) / ch));
      const r1 = Math.min(rows - 1, Math.floor((q.y + q.h + 2) / ch));
      for (let r = r0; r <= r1; r++) dist.fill(0, r * cols + c0, r * cols + c1 + 1);
    }
    for (let pass = 0; pass < QUIET_FEATHER; pass++) {
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        let d = dist[i]!;
        if (c > 0) d = Math.min(d, dist[i - 1]! + 1);
        if (c < cols - 1) d = Math.min(d, dist[i + 1]! + 1);
        if (i >= cols) d = Math.min(d, dist[i - cols]! + 1);
        if (i + cols < n) d = Math.min(d, dist[i + cols]! + 1);
        dist[i] = d;
      }
    }
    for (let i = 0; i < n; i++) {
      quiet[i] = QUIET_DIM + (1 - QUIET_DIM) * Math.min(1, dist[i]! / far);
    }
  }

  private cellIndex(x: number, y: number): number {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private stamp(field: Float32Array, x: number, y: number, radius: number, amount: number): void {
    const c0 = Math.floor(x / this.cw);
    const r0 = Math.floor(y / this.ch);
    for (let r = r0 - radius; r <= r0 + radius; r++) {
      for (let c = c0 - radius; c <= c0 + radius; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const d = Math.hypot(c - c0, (r - r0) * 1.4);
        if (d > radius + 0.5) continue;
        const i = r * this.cols + c;
        field[i] = Math.min(1.6, field[i]! + amount * (1 - d / (radius + 1)));
      }
    }
  }

  private consumeEvents(world: World): void {
    for (const e of world.events) {
      if (e.kind === 'eat') {
        this.stamp(this.heat, e.x, e.y, 2, 1);
        this.stamp(this.energy, e.x, e.y, 3, 0.9);
      } else {
        this.stamp(this.energy, e.x, e.y, 6, 1.4);
        this.flow?.splash(e.x, e.y, world.time);
      }
    }
    world.events.length = 0;
  }

  private depositWake(world: World): void {
    const { energy } = this;
    for (const m of world.motes) {
      if (!m.alive) continue;
      const i = this.cellIndex(m.x, m.y);
      if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.012 + m.alarm * 0.03);
    }
    for (const c of world.creatures) {
      const N = c.body.nodes;
      for (let k = Math.max(0, N - 6); k < N; k++) {
        const i = this.cellIndex(c.nodes[k * 2]!, c.nodes[k * 2 + 1]!);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.05 + c.speed * 0.0012);
      }
    }
    if (world.pointer.active) this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
  }

  /** 模糊加衰减：水纹像涟漪一样散开、淡掉。 */
  private diffuse(dt: number): void {
    const { cols, rows, energy, energyTmp: tmp, heat } = this;
    const decay = Math.exp(-dt * 1.5);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const e = energy[i]!;
        const l = c > 0 ? energy[i - 1]! : e;
        const rt = c < cols - 1 ? energy[i + 1]! : e;
        const u = r > 0 ? energy[i - cols]! : e;
        const d = r < rows - 1 ? energy[i + cols]! : e;
        tmp[i] = (e * 4 + l + rt + u + d) * 0.125 * decay;
      }
    }
    this.energy = tmp;
    this.energyTmp = energy;
    const heatDecay = Math.exp(-dt * 2.2);
    for (let i = 0; i < heat.length; i++) heat[i] = heat[i]! * heatDecay;
  }

  private drawHeat(world: World): void {
    const { ctx, heat, cols, cw, ch } = this;
    const tone = world.creatures[0]?.body.accent ?? 'clay';
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i]!;
      if (h < 0.08) continue;
      ctx.fillStyle = this.palette.style(tone, Math.min(0.8, h) * this.quiet[i]!);
      ctx.fillText(h > 0.6 ? '*' : '·', (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
    }
  }

  /** 小东西一只占一格：远的淡、近的浓，急转或受惊时亮一下；字按相位轮换（扇翅、迈腿、比特翻转）。 */
  private drawMotes(world: World): void {
    const { ctx, cw, ch, cols, moteStamp } = this;
    const frame = ++this.frameId;
    const flags = this.raster.flag;
    const tone = world.preyKind === 'bits' ? 'teal' : 'muted';
    for (let n = 0; n < world.motes.length; n++) {
      const m = world.motes[n]!;
      if (!m.alive) continue;
      const i = this.cellIndex(m.x, m.y);
      if (i < 0 || moteStamp[i] === frame || flags[i]) continue;
      moteStamp[i] = frame;
      const glint = clamp(Math.abs(m.turn) / 3.5, 0, 1);
      const v = 0.3 + (0.4 * (m.depth - 0.55)) / 0.45 + 0.3 * Math.max(glint, m.alarm);
      const glyphs = world.speciesGlyphs(m.species);
      const step = world.preyKind === 'bits' ? Math.floor(world.time * 0.7 + hash3(n, 0, 3) * 9)
        : Math.floor(m.phase / Math.PI);
      ctx.fillStyle = this.palette.style(tone, (0.2 + 0.6 * v) * this.quiet[i]!);
      ctx.fillText(glyphs[(step + n) % glyphs.length]!, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
    }
  }

  private drawCreatures(world: World, t: number): void {
    const { ctx, cols, rows, cw, ch, palette } = this;
    const { flag: flags, shade: shades, key: keys, owner } = this.raster;
    for (let i = 0; i < cols * rows; i++) {
      const flag = flags[i]!;
      if (!flag || flag === FLAG_CRITTER) continue;
      const c = world.creatures[owner[i]!];
      if (c === undefined) continue;
      const body = c.body;
      const g = body.glyphs;
      const key = keys[i]!;
      const shade = shades[i]!;
      const dim = (0.62 + 0.38 * c.depth) * this.quiet[i]!;
      // 颜色按错开的钟轮换，皮肤上偶尔闪一点别的颜色。
      const roll = hash3(key, Math.floor(t * 2.4 + (key % 997) / 97), 7);
      let tone = roll < 0.06 ? body.accent : body.tone;
      let alpha: number;
      let char: string;
      if (flag === FLAG_EDGE) {
        const set = shade >= 0.5 ? g.edgeHeavy : g.edgeLight;
        char = set[(key >>> 8) % set.length]!;
        alpha = 0.22 + shade * 0.3;
      } else if (flag === FLAG_RIDGE) {
        char = g.ridge[(key >>> 8) % g.ridge.length]!;
        tone = body.tone;
        alpha = 0.95;
      } else if (flag === FLAG_EYE) {
        char = g.eye;
        tone = 'ink';
        alpha = 0.9;
      } else if (flag === FLAG_MARK) {
        char = g.mark[(key >>> 8) % g.mark.length]!;
        tone = body.markTone ?? body.tone;
        alpha = 0.92;
      } else if (flag === FLAG_FIN) {
        char = g.fin[(key >>> 8) % g.fin.length]!;
        alpha = 0.42 + shade * 0.4;
      } else {
        // 亮背用疏字、暗侧用密字；深色底上反过来，密字更亮。
        const ink = palette.dark ? shade : 1 - shade;
        const jitter = ((key >>> 4) % 3) - 1;
        char = g.skin[clamp(Math.floor(ink * (g.skin.length - 0.01)) + jitter, 0, g.skin.length - 1)]!;
        alpha = 0.55 + 0.35 * ink;
      }
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      if (flag !== FLAG_EDGE) {
        // 一层很淡的底，让身体成块，不只是一堆字。
        ctx.fillStyle = palette.style(body.tone, BODY_FILL * dim);
        ctx.fillRect(x, y, cw, ch);
      }
      ctx.fillStyle = palette.style(tone, alpha * dim);
      ctx.fillText(char, x + cw / 2, y + ch / 2 + 1);
    }
  }
}
