// 主线头像（11-13 Aaron 定）：Plasticine 图标的泥团当身体，图标里那一笔漩涡当整张脸，用角色引擎的 defineShape /
// defineFace 注册，所以身体动作、右上角的状态小图标和队友一样。漩涡绕自己的视觉中心（笔画的重心）转，放在泥团的
// 重心上（Aaron：「旋涡的中心有点偏离泥团的中心了」）；干活时转，查找、阅读时跟着目光挪，静止时和图标一个朝向。
// 泥团和漩涡的路径照 shell/plasticine-mark.tsx（16 格），这里只取点。

import type { DrawnEye, EyeContext, FaceDesign, FaceLayer, Point } from '../../../vendor/plasticine-bot/engine.js';
import type * as BotEngine from '../../../vendor/plasticine-bot/engine.js';
import { PLASTICINE_BLOB_PATH, PLASTICINE_SWIRL_PATH } from '../../../shell/plasticine-mark.tsx';

export const PLASTICINE_SHAPE = 'plasticine';
export const SWIRL_FACE = 'swirl';

const numbers = (d: string): number[] => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/** 泥团的轮廓：三次贝塞尔每段取 6 个点，放大到引擎的 100 格。 */
export function blobRing(): Point[] {
  const n = numbers(PLASTICINE_BLOB_PATH);
  const points: Point[] = [];
  let x = n[0] ?? 0;
  let y = n[1] ?? 0;
  for (let i = 2; i + 5 < n.length; i += 6) {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x3 = 0, y3 = 0] = n.slice(i, i + 6);
    for (let k = 0; k < 6; k += 1) {
      const t = k / 6;
      const u = 1 - t;
      points.push([(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3) * 6.25,
        (u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3) * 6.25]);
    }
    x = x3;
    y = y3;
  }
  return points;
}

/** 漩涡的折线（隔一个点取一个），原点挪到笔画的重心，宽度归一成 1。 */
export const SWIRL_POINTS: readonly Point[] = (() => {
  const n = numbers(PLASTICINE_SWIRL_PATH);
  const raw: Point[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) raw.push([n[i] ?? 0, n[i + 1] ?? 0]);
  const kept = raw.filter((_, i) => i % 2 === 0 || i === raw.length - 1);
  let length = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i + 1 < kept.length; i += 1) {
    const [x1, y1] = kept[i] ?? [0, 0];
    const [x2, y2] = kept[i + 1] ?? [0, 0];
    const l = Math.hypot(x2 - x1, y2 - y1);
    length += l;
    cx += ((x1 + x2) / 2) * l;
    cy += ((y1 + y2) / 2) * l;
  }
  cx /= length;
  cy /= length;
  const xs = kept.map(([x]) => x);
  const span = Math.max(...xs) - Math.min(...xs);
  return kept.map(([x, y]): Point => [(x - cx) / span, (y - cy) / span]);
})();

/** 图标里笔画宽 1.5、漩涡宽 5.9：半宽占漩涡宽的比例。 */
const HALF_STROKE = 0.75 / 5.88;

/**
 * 漩涡在脸上的位置和大小，单位是引擎的眼点半径，从两眼中点量起。量法：渲 600px 的静止头像，漩涡笔画的重心对准
 * 泥团的重心（11-13 量的，tests/views/mates/bot/plasticine-face.test.ts 核对差不超过泥团宽的 2%）。
 */
export const SWIRL_PLACE = { size: 6.2, dx: 1.76, dy: 0.62 };

type Fields = 'sc' | 'ox' | 'oy' | 'spin' | 'beat';
const REST: Record<Fields, number> = { sc: 1, ox: 0, oy: 0, spin: 0, beat: 0 };

const area = (ring: readonly Point[]): number => ring.reduce((sum, [x1, y1], i) => {
  const [x2, y2] = ring[(i + 1) % ring.length] ?? [0, 0];
  return sum + x1 * y2 - x2 * y1;
}, 0);
const wound = (ring: Point[]): Point[] => (area(ring) < 0 ? ring.reverse() : ring);

/**
 * 圆头粗线：每一段一个四边形、每个点一个圆，绕向一致，非零填充自然并起来（引擎的 ribbon 在漩涡收得很紧的内圈会
 * 自交出洞）。圆用外切多边形，接缝处不缺口。
 */
export function strokeRings(points: readonly Point[], half: number,
  circle: typeof BotEngine.FACE_KIT.circleRing): Point[][] {
  const rings: Point[][] = [];
  const disc = half / Math.cos(Math.PI / 20);
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [x1, y1] = points[i] ?? [0, 0];
    const [x2, y2] = points[i + 1] ?? [0, 0];
    const l = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / l) * half;
    const ny = ((x2 - x1) / l) * half;
    rings.push(wound([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]));
  }
  for (const [x, y] of points) rings.push(wound(circle(x, y, disc, 20)));
  return rings;
}

/** 转角：所有主线头像共用一个（它们说的是同一条主线），停下时就近转回图标的朝向。 */
function turner(): (speed: number, settled: boolean) => number {
  let angle = 0;
  let last: number | null = null;
  return (speed, settled) => {
    if (settled) {
      angle = 0;
      last = null;
      return 0;
    }
    const now = performance.now() / 1000;
    const dt = last === null ? 0 : Math.min(0.1, Math.max(0, now - last));
    last = now;
    if (speed > 0.02) {
      angle = (angle + dt * speed * Math.PI * 2) % (Math.PI * 2);
    } else {
      let back = -angle;
      if (back < -Math.PI) back += Math.PI * 2;
      if (back > Math.PI) back -= Math.PI * 2;
      angle += back * Math.min(1, dt * 5);
    }
    return angle;
  };
}

export function swirlFace(engine: typeof BotEngine, id = SWIRL_FACE): FaceDesign {
  const turn = turner();
  const layers = (e: DrawnEye, ctx: EyeContext): FaceLayer[] => {
    const list = new engine.FACE_KIT.LayerList();
    const beat = (e['beat'] ?? 0) > 0.004 && !ctx.settled
      ? 1 + 0.09 * (e['beat'] ?? 0) * Math.max(0, Math.sin(ctx.time * 4.2)) : 1;
    const size = SWIRL_PLACE.size * (e['sc'] ?? 1) * beat;
    const a = -turn(e['spin'] ?? 0, ctx.settled);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const x0 = SWIRL_PLACE.dx + (e['ox'] ?? 0) + ctx.look[0] * 0.5;
    const y0 = SWIRL_PLACE.dy + (e['oy'] ?? 0) + ctx.look[1] * 0.5;
    const points = SWIRL_POINTS.map(([x, y]): Point => [(x * cos - y * sin) * size + x0,
      (x * sin + y * cos) * size + y0]);
    list.add('feature', strokeRings(points, HALF_STROKE * size, engine.FACE_KIT.circleRing));
    return list.layers;
  };
  const pair = (fields: Partial<Record<Fields, number>>) => [{ ...REST, ...fields }, { ...REST, ...fields }] as const;
  return {
    id,
    // 没有眼睛和嘴：漩涡画在两眼之间的那一层（plate）；嘴缩成零。
    layout: { lift: 0, separation: 0.2, minSeparation: 0.1, mouthDrop: 2.39, mouthScale: 0, mouthWeight: 0,
      blush: { x: 0, y: 1 }, gazeShift: 0.6 },
    expressions: {
      ...engine.FACE_KIT.vocabulary(REST, (read) => {
        switch (read.kind) {
          case 'open':
            return { sc: 0.92 + 0.08 * Math.min(1.3, read.size), ox: read.off[0] * 0.3, oy: read.off[1] * 0.3 };
          case 'smile': return { sc: 1.04 };
          case 'closed': return { sc: 0.82 };
          case 'sad': return { oy: 0.3 };
          case 'cross': return { sc: 0.9 };
          case 'star': return { sc: 1.1, spin: 1.2 };
          default: return {};
        }
      }),
      spinSlow: pair({ spin: 0.35 }),
      spin: pair({ spin: 0.8 }),
      spinFast: pair({ spin: 1.8, sc: 1.08 }),
      beat: pair({ beat: 1 }),
    },
    classes: { spinSlow: ['open', 'open'], spin: ['open', 'open'], spinFast: ['star', 'star'], beat: ['open', 'open'] },
    states: { ...engine.STATE_CUTE_EYES, thinking: ['spinSlow'], working: ['spin'], writing: ['spin'],
      composing: ['spin'], loading: ['spin'], sending: ['spin'], waiting: ['beat'], celebrate: ['spinFast'] },
    mouths: engine.CUTE_MOUTHS,
    stateMouth: engine.STATE_CUTE_MOUTH,
    mouthPaint: 'feature',
    quietFx: [],
    kaomoji: {
      eyes: { open: '@', wide: '@', small: '@', half: '@', look: '@', smile: '@', closed: '-', mad: '@', sad: '@',
        cross: '@', star: '@' },
      mouths: Object.fromEntries(Object.keys(engine.CUTE_MOUTHS).map((key) => [key, ''])),
    },
    eye: () => [],
    plate: (left, _right, ctx) => layers(left, ctx),
  };
}

/** 注册泥团和漩涡脸；引擎加载完调一次。 */
export function installPlasticineFace(engine: typeof BotEngine): void {
  engine.defineShape(PLASTICINE_SHAPE, blobRing);
  engine.defineFace(swirlFace(engine), { label: { en: 'Swirl', zh: '漩涡' } });
}
