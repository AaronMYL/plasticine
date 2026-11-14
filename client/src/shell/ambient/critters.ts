// 地上的小动物怎么动：平时溜达、坐一会儿、睡一觉；鼠标来了各有各的脾气——猫追着鼠标、追上了就坐下，小狗跑过来冒个心，
// 兔子一蹦一蹦躲开，狐狸凑近一点坐着看、鼠标冲过去就跑。点一下：猫和小狗跑过去，兔子和狐狸吓一跳跑开。

import type { Tone } from './body.ts';
import type { CritterKind, Pose } from './critter-art.ts';
import { clamp, rand } from './math.ts';
import type { QuietRect, World } from './world.ts';

export interface CritterSpec {
  kind: CritterKind;
  size: number;
  tone: Tone;
}

type Mode = 'wander' | 'rest' | 'sleep' | 'chase' | 'flee' | 'watch';

export interface Critter {
  kind: CritterKind;
  tone: Tone;
  size: number;
  /** 脚底中点。 */
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  mode: Mode;
  until: number;
  tx: number;
  ty: number;
  /** 迈步的相位。 */
  phase: number;
  /** 离地多高（兔子蹦、猫扑），像素。 */
  lift: number;
  liftV: number;
  /** 头上冒的：♥ ! ? z。 */
  mood: { glyph: string; at: number } | null;
}

interface Temper {
  walk: number;
  run: number;
  /** 歇下来时睡着的机会。 */
  sleepy: number;
  /** 鼠标多近会理它：猫狗来追，兔子狐狸躲。 */
  notice: number;
}

const TEMPER: Readonly<Record<CritterKind, Temper>> = {
  cat: { walk: 34, run: 150, sleepy: 0.3, notice: 340 },
  dog: { walk: 44, run: 175, sleepy: 0.12, notice: 460 },
  rabbit: { walk: 70, run: 170, sleepy: 0.05, notice: 150 },
  fox: { walk: 40, run: 165, sleepy: 0.15, notice: 420 },
};

const GRAVITY = 900;

export function spawnCritter(world: World, spec: CritterSpec): Critter {
  const { x, y } = emptySpot(world, spec.size, () => ({
    x: rand(world.width * 0.1, world.width * 0.9), y: rand(world.height * 0.25, world.height * 0.92),
  }));
  return {
    kind: spec.kind, tone: spec.tone, size: spec.size, x, y, vx: 0, vy: 0, facing: Math.random() < 0.5 ? 1 : -1,
    mode: 'rest', until: rand(0.5, 3), tx: x, ty: y, phase: rand(0, 4), lift: 0, liftV: 0, mood: null,
  };
}

/** 这一刻摆什么姿势。 */
export function poseOf(c: Critter): Pose {
  if (c.mode === 'sleep') return 'sleep';
  const moving = Math.hypot(c.vx, c.vy) > 6 || c.lift > 0.5;
  return moving ? 'walk' : 'sit';
}

export function stepCritters(world: World, dt: number): void {
  const clicks = world.takeClicks();
  for (const c of world.critters) {
    for (const click of clicks) react(world, c, click.x, click.y);
    sense(world, c);
    if (world.time >= c.until && (c.mode === 'rest' || c.mode === 'sleep' || c.mode === 'watch')) wander(world, c);
    move(world, c, dt);
  }
  separate(world);
}

function setMood(world: World, c: Critter, glyph: string): void {
  if (c.mood?.glyph === glyph && world.time - c.mood.at < 2) return;
  c.mood = { glyph, at: world.time };
}

/** 点了一下。 */
function react(world: World, c: Critter, x: number, y: number): void {
  const d = Math.hypot(x - c.x, y - c.y);
  if (c.kind === 'cat' || c.kind === 'dog') {
    c.mode = 'chase';
    c.tx = x;
    c.ty = y;
    c.until = world.time + 4;
    if (c.kind === 'dog') setMood(world, c, '!');
  } else if (d < 260) {
    flee(world, c, x, y);
  }
}

function flee(world: World, c: Critter, x: number, y: number): void {
  const d = Math.hypot(c.x - x, c.y - y) || 1;
  c.mode = 'flee';
  c.tx = clamp(c.x + ((c.x - x) / d) * 260, 40, world.width - 40);
  c.ty = clamp(c.y + ((c.y - y) / d) * 200, 60, world.height - 10);
  c.until = world.time + 2.5;
  setMood(world, c, '!');
}

/** 看鼠标：各按各的脾气。 */
function sense(world: World, c: Critter): void {
  const p = world.pointer;
  if (!p.active) {
    if (c.mode === 'watch') c.until = Math.min(c.until, world.time + 1);
    return;
  }
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  const temper = TEMPER[c.kind];
  if (c.kind === 'rabbit') {
    if (d < temper.notice && c.mode !== 'flee') flee(world, c, p.x, p.y);
    return;
  }
  if (c.kind === 'fox') {
    if (d < 120 || (world.pointerSpeed > 500 && d < 260)) {
      if (c.mode !== 'flee') flee(world, c, p.x, p.y);
    } else if (d < temper.notice && c.mode !== 'flee') {
      c.mode = 'watch';
      c.facing = p.x >= c.x ? 1 : -1;
      c.tx = p.x - Math.sign(p.x - c.x || 1) * 160;
      c.ty = p.y;
      c.until = world.time + 2;
      if (d < 220) setMood(world, c, '?');
    }
    return;
  }
  if (d < temper.notice && (world.pointerSpeed > 30 || c.mode === 'chase') && c.mode !== 'sleep') {
    c.mode = 'chase';
    c.tx = p.x;
    c.ty = p.y;
    c.until = world.time + 3;
  }
}

/** 换个地方溜达：挑没有字、按钮、图片的空地方（附近找不到就往远处找）。 */
function wander(world: World, c: Critter): void {
  if (c.mode === 'wander') return;
  const spot = emptySpot(world, c.size, (tries) => {
    const far = tries >= 8;
    return {
      x: clamp(far ? rand(40, world.width - 40) : c.x + rand(-320, 320), 40, world.width - 40),
      y: clamp(far ? rand(70, world.height - 10) : c.y + rand(-200, 200), 70, world.height - 10),
    };
  });
  c.mode = 'wander';
  c.tx = spot.x;
  c.ty = spot.y;
  c.until = world.time + 20;
}

/**
 * 字的位置变了（刚量出来、滚动、换页）：压在字上的小动物挪开。头一回量出来（开场时字是后量出来的）直接换到空地方；
 * 之后歇着、睡着的起身走开，正走着的要去的地方压着字就换个地方。
 */
export function relocateCritters(world: World, jump: boolean): void {
  for (const c of world.critters) {
    const here = covered(world.quietRects, c.x, c.y, c.size) > 0;
    if (jump && here) {
      const spot = emptySpot(world, c.size, () => ({
        x: rand(40, world.width - 40), y: rand(Math.min(90, world.height * 0.3), world.height - 10),
      }));
      c.x = spot.x;
      c.y = spot.y;
      c.tx = spot.x;
      c.ty = spot.y;
      continue;
    }
    const resting = c.mode === 'rest' || c.mode === 'sleep';
    const heading = c.mode === 'wander' && covered(world.quietRects, c.tx, c.ty, c.size) > 0;
    if ((resting && here) || heading) {
      c.mode = 'rest';
      wander(world, c);
    }
  }
}

const SPOT_TRIES = 16;

/** 试几处，挑和字、按钮、图片叠得最少的一处；有一处完全空着就用它。 */
function emptySpot(world: World, size: number, pick: (tries: number) => { x: number; y: number }):
  { x: number; y: number } {
  let best = pick(0);
  let least = covered(world.quietRects, best.x, best.y, size);
  for (let tries = 1; tries < SPOT_TRIES && least > 0; tries++) {
    const spot = pick(tries);
    const area = covered(world.quietRects, spot.x, spot.y, size);
    if (area < least) {
      best = spot;
      least = area;
    }
  }
  return least > 0 ? sweepSpot(world, size, best, least) : best;
}

const SWEEP_STEP = 40;

/** 随手试的几处都压着字（字占了大半屏）：按格子扫一遍整块地方，挑叠得最少的，免得停在字上。 */
function sweepSpot(world: World, size: number, best: { x: number; y: number }, least: number):
  { x: number; y: number } {
  for (let y = 70; y <= world.height - 10 && least > 0; y += SWEEP_STEP) {
    for (let x = 40; x <= world.width - 40 && least > 0; x += SWEEP_STEP) {
      const area = covered(world.quietRects, x, y, size);
      if (area < least) {
        best = { x, y };
        least = area;
      }
    }
  }
  return best;
}

/** 小动物站在 (x, y)（脚底中点）时身子和字、按钮叠了多少面积。 */
export function covered(rects: readonly QuietRect[], x: number, y: number, size: number): number {
  const half = 52 * size;
  const left = x - half;
  const right = x + half;
  const top = y - 70 * size;
  let area = 0;
  for (const r of rects) {
    const w = Math.min(right, r.x + r.w) - Math.max(left, r.x);
    const h = Math.min(y, r.y + r.h) - Math.max(top, r.y);
    if (w > 0 && h > 0) area += w * h;
  }
  return area;
}

function arrive(world: World, c: Critter): void {
  const temper = TEMPER[c.kind];
  if (c.mode === 'chase') {
    c.mode = 'rest';
    c.until = world.time + rand(1.5, 3);
    if (c.kind === 'dog') setMood(world, c, '♥');
    if (c.kind === 'cat' && c.lift === 0) c.liftV = 160;
    return;
  }
  if (c.mode === 'watch') return;
  if (c.mode === 'flee' && covered(world.quietRects, c.x, c.y, c.size) > 0) {
    // 躲到字上了：接着找个空地方。
    c.mode = 'rest';
    wander(world, c);
    return;
  }
  const sleep = Math.random() < temper.sleepy;
  c.mode = sleep ? 'sleep' : 'rest';
  c.until = world.time + (sleep ? rand(8, 16) : rand(2, 6));
}

function move(world: World, c: Critter, dt: number): void {
  const temper = TEMPER[c.kind];
  const dx = c.tx - c.x;
  const dy = c.ty - c.y;
  const d = Math.hypot(dx, dy);
  const going = c.mode === 'wander' || c.mode === 'chase' || c.mode === 'flee' || c.mode === 'watch';
  const reach = c.mode === 'chase' ? 40 * c.size : 8;
  let speed = 0;
  if (going && d > reach) {
    speed = (c.mode === 'wander' ? temper.walk : c.mode === 'watch' ? temper.walk * 1.2 : temper.run) * c.size;
  } else if (going && c.mode !== 'watch') {
    arrive(world, c);
  }
  if (c.kind === 'rabbit') {
    // 兔子一蹦一蹦：只有离地的时候往前走。
    if (speed > 0 && c.lift === 0) c.liftV = c.mode === 'flee' ? 230 : 150;
    if (c.lift === 0) speed = 0;
    else speed *= 1.6;
  }
  const want = d > 1e-3 ? speed / d : 0;
  const ease = Math.min(1, dt * 6);
  c.vx += (dx * want - c.vx) * ease;
  c.vy += (dy * want * 0.7 - c.vy) * ease;
  c.x = clamp(c.x + c.vx * dt, 30, world.width - 30);
  c.y = clamp(c.y + c.vy * dt, 60, world.height - 6);
  if (Math.abs(c.vx) > 4) c.facing = c.vx > 0 ? 1 : -1;
  else if (c.mode === 'rest' && world.pointer.active && c.kind !== 'rabbit') {
    c.facing = world.pointer.x >= c.x ? 1 : -1;
  }
  c.phase += dt * (Math.hypot(c.vx, c.vy) / 16);
  if (c.liftV !== 0 || c.lift > 0) {
    c.lift += c.liftV * dt;
    c.liftV -= GRAVITY * dt;
    if (c.lift <= 0) {
      c.lift = 0;
      c.liftV = 0;
    }
  }
  if (c.mode === 'sleep' && (c.mood === null || world.time - c.mood.at > 1.6)) c.mood = { glyph: 'z', at: world.time };
}

/** 别叠在一起。 */
function separate(world: World): void {
  const list = world.critters;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const dx = b.x - a.x;
      const dy = (b.y - a.y) * 1.6;
      const d = Math.hypot(dx, dy);
      const room = 96 * (a.size + b.size) * 0.5;
      if (d >= room || d < 1e-3) continue;
      const push = (room - d) * 0.5;
      a.x -= (dx / d) * push * 0.5;
      b.x += (dx / d) * push * 0.5;
      a.y -= (dy / d) * push * 0.3;
      b.y += (dy / d) * push * 0.3;
    }
  }
}
