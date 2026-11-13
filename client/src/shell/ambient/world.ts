// 动态背景的模拟：一群小东西和追它们的大家伙。照 ascii-sharks 的 world.ts（MIT，见 NOTICE.md）改写：
// 小东西是 Reynolds 群（分离 / 对齐 / 聚拢 + 背后盲区），受惊会一只传一只；大家伙沿一根跟随式脊柱游，
// 饿了就挑落单的追。这里多了几样：不同的身体和动法、正文那一块尽量绕开、鼠标和点击吓跑小东西。

import type { BodyId } from './bodies.ts';
import type { BodyDef } from './body.ts';
import { spawnCreature, stepCreature } from './creatures.ts';
import { spawnCritter, stepCritters, type Critter, type CritterSpec } from './critters.ts';
import type { CreatureSpec } from './figures.ts';
import { angleDiff, clamp, current, rand, randInt, TAU } from './math.ts';
import { pickSpecies, SPECIES, type PreyKind, type Species } from './prey.ts';

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
  /** 0 平静 → 1 惊慌，会传给邻居。 */
  alarm: number;
  alive: boolean;
  respawnAt: number;
  /** 摆尾 / 扇翅的相位。 */
  phase: number;
  /** 平滑后的角速度；急转弯会闪一下。 */
  turn: number;
  /** 0.55 远 → 1 近。 */
  depth: number;
  millDir: 1 | -1;
}

export interface Creature {
  id: number;
  bodyId: BodyId;
  body: BodyDef;
  length: number;
  /** 脊柱各点，吻端在前：[x0, y0, x1, y1, …]。 */
  nodes: Float32Array;
  heading: number;
  speed: number;
  cruise: number;
  phase: number;
  turn: number;
  hunger: number;
  wander: number;
  orbitDir: 1 | -1;
  orbitRadius: number;
  target: Mote | null;
  retargetAt: number;
  /** 0 远、淡 → 1 近、浓。 */
  depth: number;
  hunting: boolean;
}

export interface WorldEvent {
  kind: 'eat' | 'splash';
  x: number;
  y: number;
}

/** 正文那一块（主区坐标）：大家伙尽量绕开，渲染时也压淡。 */
export interface QuietRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SEPARATION_K = 420;
const ALIGN_K = 1.4;
const COHESION_K = 1;
const FLEE_K = 1100;
const BLIND_COS = -0.6;

export class World {
  width = 0;
  height = 0;
  time = 0;
  motes: Mote[] = [];
  creatures: Creature[] = [];
  /** 地上的小动物。 */
  critters: Critter[] = [];
  events: WorldEvent[] = [];
  pointer = { x: 0, y: 0, active: false };
  /** 鼠标移动多快（像素 / 秒，平滑过）：狐狸见鼠标冲过来就跑。 */
  pointerSpeed = 0;
  quiet: QuietRect | null = null;
  /** 每一段字、每个按钮和图片的小框：小动物挑空地方待。 */
  quietRects: readonly QuietRect[] = [];
  /** 字的位置量过了没有（头一回量出来时小动物直接换到空地方）。 */
  quietMeasured = false;
  readonly preyKind: PreyKind;
  private readonly species: readonly Species[];
  readonly specs: readonly CreatureSpec[];
  private readonly moteCount: number | undefined;
  private perception = 60;
  private sepX: number[] = [];
  private sepY: number[] = [];
  private foreignSep = 40;
  private cols = 0;
  private rows = 0;
  private head = new Int32Array(0);
  private count = new Uint16Array(0);
  private next = new Int32Array(0);
  private lastSpawn = 0;
  private readonly flow = { x: 0, y: 0 };
  private readonly critterSpecs: readonly CritterSpec[];
  private clicks: { x: number; y: number }[] = [];
  private lastPointer = { x: 0, y: 0 };

  constructor(specs: readonly CreatureSpec[], preyKind: PreyKind, moteCount?: number,
    critters: readonly CritterSpec[] = []) {
    this.specs = specs;
    this.critterSpecs = critters;
    this.preyKind = preyKind;
    this.species = SPECIES[preyKind];
    this.moteCount = moteCount;
  }

  resize(width: number, height: number, cellW: number, cellH: number): void {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.sepX = this.species.map((sp) => sp.spacing[0] * cellW);
    this.sepY = this.species.map((sp) => sp.spacing[1] * cellH);
    this.perception = Math.max(cellH * 3, cellW * 5.5);
    this.foreignSep = cellW * 3;
    if (first || this.motes.length === 0) {
      this.seed();
      return;
    }
    for (const m of this.motes) {
      m.x = clamp(m.x, 0, width);
      m.y = clamp(m.y, 0, height);
    }
  }

  seed(): void {
    const { width: W, height: H } = this;
    const minSide = Math.min(W, H);
    const base = clamp(minSide * 0.44, 150, 430);
    this.creatures = this.specs.map((spec, i) => spawnCreature(this, spec, i, base));
    // 远的（小的）先画，大的从它们上面游过。
    this.creatures.sort((a, b) => a.depth - b.depth);
    this.critters = this.critterSpecs.map((spec) => spawnCritter(this, spec));
    const total = this.moteCount ?? clamp(Math.round((W * H) / 4400), 70, 340);
    this.motes = [];
    while (this.motes.length < total) {
      const species = pickSpecies(this.species);
      const sp = this.species[species]!;
      const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.motes.length);
      const millDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const cx = rand(W * 0.06, W * 0.94);
      const cy = rand(H * 0.08, H * 0.92);
      const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
      for (let k = 0; k < size; k++) {
        this.motes.push({
          x: cx + rand(-1, 1) * this.sepX[species]! * Math.sqrt(size),
          y: cy + rand(-1, 1) * this.sepY[species]! * Math.sqrt(size) * 0.6,
          vx: Math.cos(dir) * sp.cruise, vy: Math.sin(dir) * sp.cruise,
          species, alarm: 0, alive: true, respawnAt: 0, phase: rand(0, TAU), turn: 0,
          depth: rand(0.55, 1), millDir,
        });
      }
    }
    this.next = new Int32Array(this.motes.length);
  }

  /** 点一下：附近的小东西一下子四散。 */
  splash(x: number, y: number): void {
    this.events.push({ kind: 'splash', x, y });
    this.clicks.push({ x, y });
    const r = 240;
    for (const m of this.motes) {
      if (!m.alive) continue;
      const dx = m.x - x;
      const dy = m.y - y;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 1e-3) continue;
      const k = (1 - d / r) * 260;
      m.vx += (dx / d) * k;
      m.vy += (dy / d) * k;
      m.alarm = 1;
    }
  }

  step(dt: number): void {
    this.time += dt;
    const p = this.pointer;
    const moved = Math.hypot(p.x - this.lastPointer.x, p.y - this.lastPointer.y) / dt;
    this.pointerSpeed += (moved - this.pointerSpeed) * Math.min(1, dt * 8);
    this.lastPointer = { x: p.x, y: p.y };
    this.rebuildHash();
    this.stepMotes(dt);
    for (const c of this.creatures) stepCreature(this, c, dt);
    stepCritters(this, dt);
    this.respawn();
  }

  /** 这一步之前点过的地方（小动物各自反应）；取走就清空。 */
  takeClicks(): { x: number; y: number }[] {
    const clicks = this.clicks;
    this.clicks = [];
    return clicks;
  }

  /** 这一种画成什么字。 */
  speciesGlyphs(species: number): string {
    return this.species[species]?.glyphs ?? '-';
  }

  /** 这一格附近有多少只（挑猎物时喜欢落单的）。 */
  crowdAt(x: number, y: number): number {
    return this.count[this.bucketOf(x, y)] ?? 0;
  }

  private rebuildHash(): void {
    const size = this.perception;
    this.cols = Math.ceil(this.width / size) + 4;
    this.rows = Math.ceil(this.height / size) + 4;
    const n = this.cols * this.rows;
    if (this.head.length !== n) {
      this.head = new Int32Array(n);
      this.count = new Uint16Array(n);
    }
    this.head.fill(-1);
    this.count.fill(0);
    if (this.next.length !== this.motes.length) this.next = new Int32Array(this.motes.length);
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]!;
      if (!m.alive) continue;
      const b = this.bucketOf(m.x, m.y);
      this.next[i] = this.head[b]!;
      this.head[b] = i;
      this.count[b] = this.count[b]! + 1;
    }
  }

  private bucketOf(x: number, y: number): number {
    const size = this.perception;
    const c = clamp(Math.floor(x / size) + 2, 0, this.cols - 1);
    const r = clamp(Math.floor(y / size) + 2, 0, this.rows - 1);
    return r * this.cols + c;
  }

  private stepMotes(dt: number): void {
    const calmDecay = Math.exp(-dt * 0.7);
    const contagion = Math.min(1, dt * 6);
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]!;
      if (!m.alive) continue;
      const sp = this.species[m.species]!;
      const acc = this.neighbourForces(i, m, sp);
      const fear = this.threats(m, acc);
      let alarm = Math.max(m.alarm * calmDecay, fear);
      const relayed = acc.neighbourAlarm * 0.86;
      if (relayed > alarm) alarm += (relayed - alarm) * contagion;
      m.alarm = alarm;
      this.integrate(m, sp, acc, dt);
    }
  }

  private neighbourForces(i: number, m: Mote, sp: Species): { ax: number; ay: number; neighbourAlarm: number } {
    const spread = 1 + 1.8 * m.alarm;
    const sepX = this.sepX[m.species]! * spread;
    const sepY = this.sepY[m.species]! * spread;
    const speed = Math.hypot(m.vx, m.vy) || 1;
    const hx = m.vx / speed;
    const hy = m.vy / speed;
    const R2 = this.perception * this.perception;
    let sx = 0;
    let sy = 0;
    let avx = 0;
    let avy = 0;
    let cx = 0;
    let cy = 0;
    let n = 0;
    let neighbourAlarm = 0;
    const bc = clamp(Math.floor(m.x / this.perception) + 2, 0, this.cols - 1);
    const br = clamp(Math.floor(m.y / this.perception) + 2, 0, this.rows - 1);
    for (let r = Math.max(0, br - 1); r <= Math.min(this.rows - 1, br + 1); r++) {
      for (let c = Math.max(0, bc - 1); c <= Math.min(this.cols - 1, bc + 1); c++) {
        for (let j = this.head[r * this.cols + c]!; j !== -1; j = this.next[j]!) {
          if (j === i) continue;
          const o = this.motes[j]!;
          const dx = o.x - m.x;
          const dy = o.y - m.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= R2 || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          if ((dx * hx + dy * hy) / d <= BLIND_COS) continue;
          const qx = dx / sepX;
          const qy = dy / sepY;
          const q2 = qx * qx + qy * qy;
          if (q2 < 1) {
            const q = Math.sqrt(q2) || 1e-3;
            const k = (1 - q) / q;
            sx -= qx * k;
            sy -= qy * k;
          }
          if (o.species === m.species) {
            avx += o.vx;
            avy += o.vy;
            cx += dx;
            cy += dy;
            n++;
          } else if (d < this.foreignSep) {
            const k = ((1 - d / this.foreignSep) / d) * 0.6;
            sx -= dx * k;
            sy -= dy * k;
          }
          if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
        }
      }
    }
    let ax = sx * SEPARATION_K;
    let ay = sy * SEPARATION_K;
    if (n > 0) {
      const cohesion = COHESION_K * sp.cohesion * (1 - 0.8 * m.alarm);
      ax += (avx / n - m.vx) * ALIGN_K * sp.align + (cx / n) * cohesion;
      ay += (avy / n - m.vy) * ALIGN_K * sp.align + (cy / n) * cohesion;
      if (sp.mill > 0) {
        const cl = Math.hypot(cx, cy) || 1;
        ax += (-cy / cl) * m.millDir * sp.mill * (1 - m.alarm);
        ay += (cx / cl) * m.millDir * sp.mill * (1 - m.alarm);
      }
    }
    return { ax, ay, neighbourAlarm };
  }

  /** 大家伙和鼠标都是威胁：往开了躲，从大家伙前进方向的两侧闪开（「喷泉效应」）。 */
  private threats(m: Mote, acc: { ax: number; ay: number }): number {
    let fear = 0;
    for (const c of this.creatures) {
      const fearR = c.length * 0.6 + 60;
      let best = Infinity;
      let bx = 0;
      let by = 0;
      const front = Math.min(c.body.nodes - 1, Math.round(c.body.nodes * 0.6));
      for (let k = 0; k <= front; k += 3) {
        const nx = c.nodes[k * 2]!;
        const ny = c.nodes[k * 2 + 1]!;
        const d2 = (m.x - nx) ** 2 + (m.y - ny) ** 2;
        if (d2 < best) {
          best = d2;
          bx = nx;
          by = ny;
        }
      }
      const d = Math.sqrt(best);
      if (d >= fearR || d < 1e-3) continue;
      let w = 1 - d / fearR;
      w *= w;
      const shx = Math.cos(c.heading);
      const shy = Math.sin(c.heading);
      const side = shx * (m.y - c.nodes[1]!) - shy * (m.x - c.nodes[0]!) >= 0 ? 1 : -1;
      acc.ax += (((m.x - bx) / d) * 0.7 - shy * side * 0.9) * FLEE_K * w;
      acc.ay += (((m.y - by) / d) * 0.7 + shx * side * 0.9) * FLEE_K * w;
      fear = Math.max(fear, Math.sqrt(w));
    }
    if (this.pointer.active) {
      const dx = m.x - this.pointer.x;
      const dy = m.y - this.pointer.y;
      const d = Math.hypot(dx, dy);
      if (d < 130 && d > 1e-3) {
        const w = (1 - d / 130) ** 2;
        acc.ax += (dx / d) * FLEE_K * w;
        acc.ay += (dy / d) * FLEE_K * w;
        fear = Math.max(fear, Math.sqrt(w) * 0.8);
      }
    }
    return fear;
  }

  private integrate(m: Mote, sp: Species, acc: { ax: number; ay: number }, dt: number): void {
    const { width: W, height: H } = this;
    let { ax, ay } = acc;
    const edge = 36;
    if (m.x < edge) ax += (edge - m.x) * 7;
    else if (m.x > W - edge) ax -= (m.x - (W - edge)) * 7;
    if (m.y < edge) ay += (edge - m.y) * 7;
    else if (m.y > H - edge) ay -= (m.y - (H - edge)) * 7;
    current(m.x, m.y, this.time, this.flow);
    ax += this.flow.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
    ay += this.flow.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
    ay -= m.vy * sp.verticalDrag * (1 - 0.7 * m.alarm);
    const speed = Math.hypot(m.vx, m.vy) || 1;
    const preferred = sp.cruise * (1 + 1.3 * m.alarm);
    ax += ((preferred - speed) * m.vx * 1.6) / speed;
    ay += ((preferred - speed) * m.vy * 1.6) / speed;
    const before = Math.atan2(m.vy, m.vx);
    m.vx += ax * dt;
    m.vy += ay * dt;
    const maxSpeed = sp.maxSpeed * (1 + 1.8 * m.alarm);
    const s = Math.hypot(m.vx, m.vy);
    if (s > maxSpeed) {
      m.vx *= maxSpeed / s;
      m.vy *= maxSpeed / s;
    } else if (s < sp.minSpeed && s > 1e-3) {
      m.vx *= sp.minSpeed / s;
      m.vy *= sp.minSpeed / s;
    }
    m.turn += (angleDiff(before, Math.atan2(m.vy, m.vx)) / dt - m.turn) * Math.min(1, dt * 8);
    m.phase += dt * (7 + Math.hypot(m.vx, m.vy) * 0.12);
    m.x = clamp(m.x + m.vx * dt, -60, W + 60);
    m.y = clamp(m.y + m.vy * dt, -60, H + 60);
  }

  /** 被吃掉的过一会儿从边上整群游回来，总数不变。 */
  private respawn(): void {
    const { time, width: W, height: H } = this;
    const due = this.motes.filter((m) => !m.alive && m.respawnAt <= time);
    if (due.length === 0 || (due.length < 6 && time - this.lastSpawn < 9)) return;
    this.lastSpawn = time;
    const side = randInt(0, 3);
    const along = rand(0.15, 0.85);
    const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
    const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
    const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
    const species = pickSpecies(this.species);
    const sp = this.species[species]!;
    const millDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    for (const m of due.slice(0, sp.schoolSize[1])) {
      Object.assign(m, {
        alive: true, species, alarm: 0, turn: 0, millDir,
        x: x + rand(-1, 1) * this.perception, y: y + rand(-1, 1) * this.perception,
        vx: Math.cos(inward) * sp.cruise * 1.4, vy: Math.sin(inward) * sp.cruise * 1.4,
      });
    }
  }
}
