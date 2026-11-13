// 大家伙怎么动：巡游、挑猎物、追、绕开别的大家伙和正文、脊柱一节跟一节、吃。照 ascii-sharks 的 world.ts（MIT，见 NOTICE.md），
// 换成通用的身体（各自的速度、灵活度、追不追），正文那一块尽量绕着走。

import { BODIES } from './bodies.ts';
import type { CreatureSpec } from './figures.ts';
import { angleDiff, clamp, rand, TAU } from './math.ts';
import type { Creature, Mote, QuietRect, World } from './world.ts';

export function spawnCreature(world: World, spec: CreatureSpec, i: number, base: number): Creature {
  const minSide = Math.min(world.width, world.height);
  const { width: W, height: H } = world;
  const body = BODIES[spec.body];
  const length = base * spec.size * body.motion.size;
  const count = world.specs.length;
  const orbitRadius = minSide * rand(0.28, 0.4);
  const a = (i / count) * TAU + rand(-0.4, 0.4);
  const orbitDir: 1 | -1 = i % 2 === 0 ? 1 : -1;
  const x = W / 2 + Math.cos(a) * orbitRadius * (W / minSide) * 0.9;
  const y = H / 2 + Math.sin(a) * orbitRadius;
  const heading = a + (orbitDir * Math.PI) / 2;
  const nodes = new Float32Array(body.nodes * 2);
  const seg = length / (body.nodes - 1);
  for (let n = 0; n < body.nodes; n++) {
    nodes[n * 2] = x - Math.cos(heading) * seg * n;
    nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
  }
  const cruise = (30 + length * 0.04) * body.motion.cruise;
  return {
    id: i + 1, bodyId: spec.body, body, length, nodes, heading, speed: cruise, cruise,
    phase: rand(0, TAU), turn: 0, hunger: rand(0.25, 0.75), wander: 0, orbitDir, orbitRadius,
    target: null, retargetAt: 0, depth: spec.size, hunting: false,
  };
}

export function stepCreature(world: World, c: Creature, dt: number): void {
  const { width: W, height: H, time } = world;
  const L = c.length;
  const hx = c.nodes[0]!;
  const hy = c.nodes[1]!;
  c.hunger = Math.min(1, c.hunger + dt * 0.03);
  let dx = Math.cos(c.heading);
  let dy = Math.sin(c.heading);
  c.wander = clamp(c.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
  dx += Math.cos(c.heading + c.wander) * 0.45;
  dy += Math.sin(c.heading + c.wander) * 0.45;
  if (time >= c.retargetAt) {
    c.target = c.body.motion.hunt > 0 ? findPrey(world, c) : null;
    c.retargetAt = time + 0.45;
  }
  const t = c.target;
  let closing = 0;
  c.hunting = t !== null && t.alive && c.hunger > 0.3;
  if (t !== null && c.hunting) {
    const tx = t.x + t.vx * 0.35 - hx;
    const ty = t.y + t.vy * 0.35 - hy;
    const d = Math.hypot(tx, ty) || 1;
    const w = (1.4 + 2.6 * c.hunger) * c.body.motion.hunt;
    dx += (tx / d) * w;
    dy += (ty / d) * w;
    closing = clamp(1 - d / (L * 0.9), 0, 1);
  } else {
    const round = patrol(world, c, hx, hy);
    dx += round.x;
    dy += round.y;
  }
  const avoid = avoidance(world, c, hx, hy, L);
  dx += avoid.x;
  dy += avoid.y;
  // 碰到边往里推（垂直于那条边；往正中推会把它们推进正文）。
  const edge = L * 0.05;
  const soft = L * 0.35;
  const wall = (over: number): number => clamp((over + edge) / soft, 0, 1) * 3.5;
  dx += wall(-hx) - wall(hx - W);
  dy += wall(-hy) - wall(hy - H);
  const desired = Math.atan2(dy, dx);
  const agility = Math.min((c.hunting ? 1.7 + closing : 0.8) * c.body.motion.agility, c.speed / (L * 0.22));
  const maxTurn = agility * dt;
  const turned = clamp(angleDiff(c.heading, desired), -maxTurn, maxTurn);
  c.heading += turned;
  c.turn += (turned / dt - c.turn) * Math.min(1, dt * 3);
  const targetSpeed = c.hunting ? c.cruise * (1.45 + closing * 1.5) : c.cruise;
  c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 1.1);
  c.phase += dt * (2 + c.speed / 24);
  moveSpine(world, c, dt);
  if (c.hunger > 0.15) feed(world, c, time);
}

/**
 * 不追的时候绕着圈慢慢巡。有正文那一块：正文是竖着的一栏、两边空地够宽，就在自己这边的空地里上下兜圈；
 * 不然绕着正文转一个比它宽的椭圆。
 */
function patrol(world: World, c: Creature, hx: number, hy: number): { x: number; y: number } {
  const { width: W, height: H, time } = world;
  const minSide = Math.min(W, H);
  const q = avoidable(world);
  let cx = W / 2;
  let cy = H / 2;
  let ax = c.orbitRadius * (W / minSide);
  let ay = c.orbitRadius;
  if (q !== null) {
    const lane = laneOf(world, q, hx, c.length);
    cx = lane?.x ?? q.x + q.w / 2;
    cy = q.y + q.h / 2;
    ax = lane?.half ?? Math.max(ax, q.w / 2 + c.length * 0.35);
    ay = lane === null ? Math.max(ay, q.h / 2 + c.length * 0.35) : H / 2 - c.length * 0.15;
  }
  const wobble = 1 + 0.15 * Math.sin(time * 0.05 + c.id);
  const rx = (hx - cx) / (ax * wobble);
  const ry = (hy - cy) / (ay * wobble);
  const r = Math.hypot(rx, ry) || 1;
  const radial = clamp(1 - r, -1, 1);
  const tx = (-ry / r) * ax * c.orbitDir;
  const ty = (rx / r) * ay * c.orbitDir;
  const t = Math.hypot(tx, ty) || 1;
  return {
    x: (tx / t + (rx / r) * radial * 0.9) * 0.55,
    y: (ty / t + (ry / r) * radial * 0.9) * 0.55,
  };
}

/** 正文竖着占了大半高时，头所在那一边的空地（中线、半宽）；那边太窄就是 null。 */
function laneOf(world: World, q: QuietRect, hx: number, length: number): { x: number; half: number } | null {
  if (q.h < world.height * 0.55) return null;
  const left = hx < q.x + q.w / 2;
  const from = left ? 0 : q.x + q.w;
  const to = left ? q.x : world.width;
  if (to - from < length * 0.3) return null;
  return { x: (from + to) / 2, half: Math.max((to - from) / 2, length * 0.2) };
}

/** 正文那一块够窄才绕（太宽了绕不开，只在渲染时压淡）。 */
function avoidable(world: World): QuietRect | null {
  const q = world.quiet;
  return q !== null && q.w < world.width * 0.75 ? q : null;
}

function avoidance(world: World, c: Creature, hx: number, hy: number, L: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const other of world.creatures) {
    if (other === c) continue;
    const range = (L + other.length) * 0.45;
    for (let k = 0; k < other.body.nodes; k += 4) {
      const ox = hx - other.nodes[k * 2]!;
      const oy = hy - other.nodes[k * 2 + 1]!;
      const d = Math.hypot(ox, oy);
      if (d < range && d > 1e-3) {
        const w = (1 - d / range) * 3;
        x += (ox / d) * w;
        y += (oy / d) * w;
      }
    }
  }
  const q = avoidable(world);
  const out = q === null ? null : exitOf(world, q, hx, hy, L);
  if (out !== null) {
    const w = c.hunting ? 0.5 : 1.4;
    x += out.x * w;
    y += out.y * w;
  }
  return { x, y };
}

/** 头在正文那一块里（四周放宽 24）时，往最近的、外面还有地方的那条边出去。 */
function exitOf(world: World, q: QuietRect, hx: number, hy: number, L: number): { x: number; y: number } | null {
  const pad = 24;
  if (hx < q.x - pad || hx > q.x + q.w + pad || hy < q.y - pad || hy > q.y + q.h + pad) return null;
  const room = L * 0.2;
  let best: { x: number; y: number } | null = null;
  let nearest = Infinity;
  const exit = (depth: number, space: number, x: number, y: number): void => {
    if (space > room && depth < nearest) {
      nearest = depth;
      best = { x, y };
    }
  };
  exit(hx - q.x, q.x, -1, 0);
  exit(q.x + q.w - hx, world.width - q.x - q.w, 1, 0);
  exit(hy - q.y, q.y, 0, -1);
  exit(q.y + q.h - hy, world.height - q.y - q.h, 0, 1);
  return best;
}

/** 吻端往前走一步，后面的节一节跟一节，每节最多弯 maxBend。 */
function moveSpine(world: World, c: Creature, dt: number): void {
  const nodes = c.nodes;
  const N = c.body.nodes;
  nodes[0] = nodes[0]! + Math.cos(c.heading) * c.speed * dt;
  nodes[1] = nodes[1]! + Math.sin(c.heading) * c.speed * dt;
  const seg = c.length / (N - 1);
  let prevAngle = c.heading + Math.PI;
  for (let k = 1; k < N; k++) {
    const px = nodes[(k - 1) * 2]!;
    const py = nodes[(k - 1) * 2 + 1]!;
    let angle = Math.atan2(nodes[k * 2 + 1]! - py, nodes[k * 2]! - px);
    angle = prevAngle + clamp(angleDiff(prevAngle, angle), -c.body.maxBend, c.body.maxBend);
    nodes[k * 2] = px + Math.cos(angle) * seg;
    nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
    prevAngle = angle;
  }
}

function feed(world: World, c: Creature, time: number): void {
  const mouthR = c.length * 0.05 + 8;
  const mx = c.nodes[0]!;
  const my = c.nodes[1]!;
  for (const m of world.motes) {
    if (!m.alive || (m.x - mx) ** 2 + (m.y - my) ** 2 >= mouthR * mouthR) continue;
    m.alive = false;
    m.respawnAt = time + rand(3, 8);
    c.hunger = Math.max(0, c.hunger - 0.16);
    world.events.push({ kind: 'eat', x: m.x, y: m.y });
  }
}

/** 在前方扇形里挑：近的、落单的优先，扎在密群里的不好抓。 */
function findPrey(world: World, c: Creature): Mote | null {
  const range = c.length * 0.9 + 160;
  const hx = c.nodes[0]!;
  const hy = c.nodes[1]!;
  const fx = Math.cos(c.heading);
  const fy = Math.sin(c.heading);
  const q = avoidable(world);
  let best: Mote | null = null;
  let bestScore = Infinity;
  let currentScore = Infinity;
  for (const m of world.motes) {
    if (!m.alive) continue;
    // 不追进正文那一块。
    if (q !== null && m.x > q.x && m.x < q.x + q.w && m.y > q.y && m.y < q.y + q.h) continue;
    const dx = m.x - hx;
    const dy = m.y - hy;
    const d = Math.hypot(dx, dy);
    if (d > range || d < 1e-3) continue;
    const cos = (dx * fx + dy * fy) / d;
    if (cos < 0.2) continue;
    const score = d * (1 + (1 - cos) * 0.8) * (1 + world.crowdAt(m.x, m.y) * 0.07);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
    if (m === c.target) currentScore = score;
  }
  if (c.target !== null && currentScore < bestScore * 1.3) return c.target;
  return best;
}
