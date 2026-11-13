// 把大家伙按格子栅格化：每格中心加四个子采样点去问「这一点落在身体的哪儿」，全落在里面的是实心皮肤，
// 落一部分的是轮廓（画淡字，等于抗锯齿）。做法照 ascii-sharks 的 renderer.ts（MIT，见 NOTICE.md），
// 换成通用的身体：任意节数的脊柱、鳍和翅膀、三种尾巴、两种花纹，吻端前也能长东西（蝠鲼的头鳍）。

import type { BodyDef, Limb } from './body.ts';
import { clamp, hash3, inTriangle } from './math.ts';
import type { Creature } from './world.ts';

export const FLAG_BODY = 1;
export const FLAG_EDGE = 2;
export const FLAG_FIN = 3;
export const FLAG_RIDGE = 4;
export const FLAG_EYE = 5;
export const FLAG_MARK = 6;

const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];
const MAX_NODES = 48;

export class CreatureRaster {
  flag = new Uint8Array(0);
  shade = new Float32Array(0);
  key = new Uint32Array(0);
  /** 这一格属于第几只（world.creatures 的下标）。 */
  owner = new Uint8Array(0);
  private cols = 0;
  private rows = 0;
  private cw = 10;
  private ch = 15;
  private readonly spine = new Float32Array(MAX_NODES * 2);
  private readonly arc = new Float32Array(MAX_NODES);
  private arcTotal = 1;
  private nodes = 2;
  private body: BodyDef | null = null;
  private beat = 0;
  private time = 0;
  private id = 0;
  private reachScale = [1, 1];
  private hitFlag = 0;
  private hitShade = 0;
  private hitS = 0;
  private hitV = 0;
  private hitDist = 0;

  resize(cols: number, rows: number, cw: number, ch: number): void {
    this.cols = cols;
    this.rows = rows;
    this.cw = cw;
    this.ch = ch;
    const n = cols * rows;
    if (this.flag.length !== n) {
      this.flag = new Uint8Array(n);
      this.shade = new Float32Array(n);
      this.key = new Uint32Array(n);
      this.owner = new Uint8Array(n);
    }
  }

  rasterize(creatures: readonly Creature[], t: number): void {
    this.flag.fill(0);
    this.time = t;
    creatures.forEach((c, index) => this.rasterizeOne(c, index, t));
  }

  private rasterizeOne(c: Creature, index: number, t: number): void {
    const { cw, ch, cols, rows } = this;
    const body = c.body;
    const L = c.length;
    this.body = body;
    this.id = c.id;
    this.buildSpine(c);
    // 扇翅：鹰追的时候用力扇、巡游时滑翔；蝠鲼一直慢慢扇。
    const effort = clamp((c.speed - c.cruise) / c.cruise + 0.25, 0.2, 1);
    this.beat = Math.sin(c.phase * (body.motion.hunt > 0 ? 1.3 : 0.7)) * (c.bodyId === 'manta' ? 1 : effort);
    const bank = clamp(c.turn * 0.45, -0.35, 0.35);
    const flex = 1 + 0.06 * Math.sin(c.phase * 0.5);
    this.reachScale = [flex * (1 + bank), flex * (1 - bank)];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < this.nodes; k++) {
      minX = Math.min(minX, this.spine[k * 2]!);
      maxX = Math.max(maxX, this.spine[k * 2]!);
      minY = Math.min(minY, this.spine[k * 2 + 1]!);
      maxY = Math.max(maxY, this.spine[k * 2 + 1]!);
    }
    const reach = L * 0.7;
    const c0 = Math.max(0, Math.floor((minX - reach) / cw));
    const c1 = Math.min(cols - 1, Math.floor((maxX + reach) / cw));
    const r0 = Math.max(0, Math.floor((minY - reach) / ch));
    const r1 = Math.min(rows - 1, Math.floor((maxY + reach) / ch));
    const skipBeyond = reach + Math.hypot(cw, ch);
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const x = col * cw;
        const y = r * ch;
        const centerHit = this.sample(x + cw / 2, y + ch / 2, L);
        if (!centerHit && this.hitDist > skipBeyond) continue;
        const flag = this.hitFlag;
        const shade = this.hitShade;
        const s = this.hitS;
        const v = this.hitV;
        let hits = centerHit ? 1 : 0;
        for (let k = 0; k < SUBSAMPLES.length; k += 2) {
          if (this.sample(x + SUBSAMPLES[k]! * cw, y + SUBSAMPLES[k + 1]! * ch, L)) hits++;
        }
        if (hits === 0) continue;
        const coverage = hits / 5;
        const i = r * cols + col;
        // 跟着皮肤走的键：每个字随身体移动，不在原地闪。
        this.key[i] = (hash3(Math.round(s * 52), Math.round(v / (cw * 0.9)), c.id) * 4294967295) >>> 0;
        this.owner[i] = index;
        if (centerHit && coverage >= 0.6) {
          this.flag[i] = flag;
          const flicker = (hash3(col, r, Math.floor(t * 6)) - 0.5) * 0.06;
          this.shade[i] = clamp(shade + flicker, 0, 1);
        } else {
          this.flag[i] = FLAG_EDGE;
          this.shade[i] = coverage;
        }
      }
    }
  }

  /** 模拟里的脊柱加上一道从头往尾越来越大的横波，就是游动的样子。 */
  private buildSpine(c: Creature): void {
    const body = c.body;
    const N = Math.min(MAX_NODES, body.nodes);
    const n = c.nodes;
    const L = c.length;
    const swim = clamp(c.speed / 60, 0.4, 1.4);
    this.nodes = N;
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const a = Math.max(0, k - 1);
      const b = Math.min(N - 1, k + 1);
      let tx = n[a * 2]! - n[b * 2]!;
      let ty = n[a * 2 + 1]! - n[b * 2 + 1]!;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const amp = L * body.wave * (0.1 + 0.9 * Math.pow(s, 1.8)) * swim;
      const off = amp * Math.sin(c.phase - s * body.waveLength);
      this.spine[k * 2] = n[k * 2]! - ty * off;
      this.spine[k * 2 + 1] = n[k * 2 + 1]! + tx * off;
    }
    this.arc[0] = 0;
    for (let k = 1; k < N; k++) {
      const dx = this.spine[k * 2]! - this.spine[(k - 1) * 2]!;
      const dy = this.spine[k * 2 + 1]! - this.spine[(k - 1) * 2 + 1]!;
      this.arc[k] = this.arc[k - 1]! + Math.hypot(dx, dy);
    }
    this.arcTotal = this.arc[N - 1] || 1;
  }

  /**
   * 一点落在身体的哪儿：s 沿脊柱（吻端 0 → 尾尖 1，前后可以超出），v 横向（带符号）。
   * 写进 hit*，返回是否在身上。
   */
  private sample(px: number, py: number, L: number): boolean {
    const body = this.body!;
    const { spine, arc, nodes: N } = this;
    let best = Infinity;
    let bestS = 0;
    let bestSign = 1;
    let bestNx = 0;
    let bestNy = 0;
    for (let k = 0; k < N - 1; k++) {
      const ax = spine[k * 2]!;
      const ay = spine[k * 2 + 1]!;
      const sx = spine[(k + 1) * 2]! - ax;
      const sy = spine[(k + 1) * 2 + 1]! - ay;
      const len2 = sx * sx + sy * sy || 1;
      const raw = ((px - ax) * sx + (py - ay) * sy) / len2;
      // 第一节往前不截断：蝠鲼的头鳍长在吻端前面。
      const u = clamp(raw, k === 0 ? -0.6 : 0, 1);
      const qx = ax + sx * u;
      const qy = ay + sy * u;
      const d2 = (px - qx) ** 2 + (py - qy) ** 2;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        bestS = (arc[k]! + u * len) / this.arcTotal;
        bestSign = sx * (py - ay) - sy * (px - ax) >= 0 ? 1 : -1;
        bestNx = (-sy / len) * bestSign;
        bestNy = (sx / len) * bestSign;
      }
    }
    const a = Math.sqrt(best);
    const s = bestS;
    const u = s * L;
    this.hitDist = a;
    this.hitS = s;
    this.hitV = a * bestSign;
    if (body.head && this.sampleHead(body.head, a, u, L)) return true;
    const w = s < 0 || s > 1 ? 0 : body.halfWidth(s, this.beat) * L;
    if (a <= w) {
      this.sampleSkin(body, s, a / (w || 1), bestNx, bestNy);
      return true;
    }
    if (this.sampleLimbs(body.limbs, u, a, bestSign, L)) return true;
    return this.sampleTail(body, u, a, L);
  }

  private sampleHead(head: NonNullable<BodyDef['head']>, a: number, u: number, L: number): boolean {
    if (u >= L * (head.sweep + head.depth + head.notch)) return false;
    const span = L * head.span;
    const r = a / span;
    const front = L * head.sweep * r * r + L * head.notch * Math.max(0, 1 - r / 0.14);
    const depth = L * head.depth * (1 - 0.2 * r * r * r * r);
    if (r > 1 || u < front || u > front + depth) return false;
    this.hitFlag = r > 0.84 ? FLAG_EYE : FLAG_BODY;
    this.hitShade = r > 0.84 ? 0 : 0.62 - 0.2 * r + (u < front + L * 0.012 ? 0.1 : 0);
    return true;
  }

  /** across：离脊柱多远，占半宽的比例。 */
  private sampleSkin(body: BodyDef, s: number, across: number, nx: number, ny: number): void {
    // 背是圆的，光从左上来，两侧暗下去。
    const facing = (nx * -0.6 + ny * -0.8) * across;
    let shade = 0.58 - across * across * 0.42 + facing * 0.26;
    let flag = FLAG_BODY;
    if (body.dorsal && s > body.dorsal[0] && s < body.dorsal[1] && across < body.dorsalWidth) {
      flag = FLAG_RIDGE;
      shade = 1;
    } else if (body.secondDorsal && s > body.secondDorsal[0] && s < body.secondDorsal[1] && across < 0.4) {
      shade = Math.max(shade, 0.82);
    } else if (body.eye && s > body.eye[0] && s < body.eye[1] && across > body.eyeAcross) {
      flag = FLAG_EYE;
      shade = 0;
    } else if (body.gills && s > body.gills[0] && s < body.gills[1] && across > 0.58) {
      const slit = Math.floor(((s - body.gills[0]) / (body.gills[1] - body.gills[0])) * 5);
      if (slit % 2 === 0) shade *= 0.45;
    } else if (s < 0.05) {
      shade = Math.max(shade, 0.7);
    } else if (this.marked(body, s, across)) {
      flag = FLAG_MARK;
    }
    this.hitFlag = flag;
    this.hitShade = shade;
  }

  private sampleLimbs(limbs: readonly Limb[], u: number, a: number, sign: number, L: number): boolean {
    const side = sign > 0 ? 0 : 1;
    for (const limb of limbs) {
      let reach = L * limb.reach * this.reachScale[side]!;
      if (limb.flap !== undefined) reach *= 1 - limb.flap * this.beat * this.beat;
      const tip = limb.tip;
      if (!inTriangle(u, a, L * limb.root0, 0, L * limb.root1, 0, L * tip, reach)) continue;
      if (limb.falcate === true) {
        const mid = limb.root1 + (tip - limb.root1) * 0.33;
        if (inTriangle(u, a, L * limb.root1, 0, L * mid, reach * 0.55, L * tip, reach)) continue;
      }
      const body = this.body!;
      const feather = body.marks === 'feathers' && Math.sin((a / L) * 55) > 0.55;
      this.hitFlag = feather ? FLAG_MARK : FLAG_FIN;
      this.hitShade = 0.38 + 0.22 * (1 - clamp(a / Math.max(1, reach), 0, 1));
      return true;
    }
    return false;
  }

  private sampleTail(body: BodyDef, u: number, a: number, L: number): boolean {
    const tail = body.tail;
    if (tail === null) return false;
    const from = L * tail.from;
    const reach = L * tail.reach;
    let hit = false;
    if (tail.kind === 'fork') {
      hit = inTriangle(u, a, from, 0, from + (L - from) * 0.64, 0, L, reach);
    } else if (tail.kind === 'fluke') {
      hit = inTriangle(u, a, from, 0, L, 0, L * 1.02, reach);
    } else {
      hit = inTriangle(u, a, from, 0, L * 1.0, 0, L * 1.04, reach)
        || inTriangle(u, a, from, 0, L * 1.04, reach, L * 1.05, reach * 0.4);
    }
    if (!hit) return false;
    this.hitFlag = FLAG_FIN;
    this.hitShade = 0.36;
    return true;
  }

  /** 花纹：一点（s 沿身）是不是落在花纹上（机械鲨的线路）。羽毛的横纹在翅膀上画（sampleLimbs）。 */
  private marked(body: BodyDef, s: number, across: number): boolean {
    if (body.marks !== 'circuit' || s < 0.06) return false;
    const trace = Math.abs(across - 0.45) < 0.08 || Math.abs(across - 0.8) < 0.06;
    const node = Math.abs(Math.sin(s * Math.PI * 14)) > 0.97 && across < 0.85;
    return trace || node;
  }

  /** 这一刻的时间（画的时候皮肤颜色按它轮换）。 */
  get now(): number {
    return this.time;
  }
}
