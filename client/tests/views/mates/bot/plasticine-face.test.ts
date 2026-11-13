// 主线头像（11-13）：泥团加漩涡脸。漩涡的重心要落在泥团的重心上（Aaron：「旋涡的中心有点偏离泥团的中心了」），
// 静止的那一张漩涡用页面底色，干活时漩涡转、空闲时和图标一个朝向。

import { describe, expect, it } from 'vitest';
import { loadBotEngine } from '../../../../src/views/mates/bot/bot-engine.ts';
import { recolorDrawnFace, stillSvg } from '../../../../src/views/mates/bot/bot-render.ts';
import { SWIRL_POINTS } from '../../../../src/views/mates/bot/plasticine-face.ts';

type Pt = [number, number];

const numbers = (text: string): number[] => (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

/** 路径里的三次贝塞尔每段取 8 个点（控制点不在轮廓上，直接当多边形算重心会偏）。 */
function sampled(d: string): Pt[] {
  const values = numbers(d);
  const out: Pt[] = [];
  let x = values[0]!;
  let y = values[1]!;
  for (let i = 2; i + 5 < values.length; i += 6) {
    const [x1, y1, x2, y2, x3, y3] = values.slice(i, i + 6) as [number, number, number, number, number, number];
    for (let k = 0; k < 8; k += 1) {
      const t = k / 8;
      const u = 1 - t;
      out.push([u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]);
    }
    x = x3;
    y = y3;
  }
  return out;
}

function pairs(values: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) out.push([values[i]!, values[i + 1]!]);
  return out;
}

function inside(ring: readonly Pt[], [x, y]: Pt): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** 几个多边形的并在一格一格的网格上的重心；每个多边形先看外框，不在框里就不细算。 */
function gridCentroid(rings: readonly (readonly Pt[])[]): { x: number; y: number; width: number } {
  const boxes = rings.map((ring) => {
    const xs = ring.map(([px]) => px);
    const ys = ring.map(([, py]) => py);
    return { ring, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const x0 = Math.min(...boxes.map((box) => box.x0));
  const x1 = Math.max(...boxes.map((box) => box.x1));
  const y0 = Math.min(...boxes.map((box) => box.y0));
  const y1 = Math.max(...boxes.map((box) => box.y1));
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (boxes.some((box) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && inside(box.ring, [x, y]))) {
        n += 1;
        sx += x;
        sy += y;
      }
    }
  }
  return { x: sx / n, y: sy / n, width: x1 - x0 };
}

/** translate(a b) matrix(p q r s 0 0) translate(c d)，从右往左套到点上。 */
function transformer(attribute: string): (point: Pt) => Pt {
  const [a = 0, b = 0, p = 1, q = 0, r = 0, s = 1, , , c = 0, d = 0] = numbers(attribute);
  return ([x, y]) => {
    const u = x + c;
    const v = y + d;
    return [p * u + r * v + a, q * u + s * v + b];
  };
}

describe('主线头像', () => {
  it('漩涡笔画的重心落在泥团的重心上', async () => {
    const engine = await loadBotEngine();
    const svg = engine.renderStaticSvg({ shape: 'plasticine', face: 'swirl', state: 'idle', sizePx: 480 });
    const body = /<path d="([^"]+)" fill="[^"]+"\/>/.exec(svg)?.[1] ?? '';
    expect(body).toMatch(/^M[\d.\s-]+C/);
    const face = /<g data-plasticine-face="">\s*<path d="([^"]+)" transform="([^"]+)"/.exec(svg);
    expect(face).not.toBeNull();
    const move = transformer(face![2]!);
    const rings = face![1]!.split('Z').filter((part) => part.trim() !== '')
      .map((ring) => pairs(numbers(ring)).map(move));
    // 像屏幕上那样数：在格子上逐点看落没落在形状里（笔画自己叠着的地方只算一次）。
    const blob = gridCentroid([sampled(body)]);
    const swirl = gridCentroid(rings);
    expect(Math.abs(swirl.x - blob.x) / blob.width).toBeLessThan(0.02);
    expect(Math.abs(swirl.y - blob.y) / blob.width).toBeLessThan(0.02);
  });

  it('漩涡的点绕笔画重心放（转起来不晃），宽度归一', () => {
    const xs = SWIRL_POINTS.map(([px]) => px);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 5);
    let length = 0;
    let cx = 0;
    for (let i = 0; i + 1 < SWIRL_POINTS.length; i += 1) {
      const [x1, y1] = SWIRL_POINTS[i]!;
      const [x2, y2] = SWIRL_POINTS[i + 1]!;
      const l = Math.hypot(x2 - x1, y2 - y1);
      length += l;
      cx += ((x1 + x2) / 2) * l;
    }
    expect(Math.abs(cx / length)).toBeLessThan(1e-9);
  });

  it('静止的那一张：泥团是强调色，漩涡是页面底色（深色主题下和图标一样是深色的线）', async () => {
    const engine = await loadBotEngine();
    const svg = stillSvg(engine, { kind: 'main' }, 'idle', 28);
    expect(svg).toContain('var(--accent)');
    const face = /<g data-plasticine-face="">[\s\S]*?<\/g>/.exec(svg)?.[0] ?? '';
    expect(face).toContain('fill="var(--bg)"');
    expect(face).not.toContain('#FFFFFF');
    expect(recolorDrawnFace('<g data-plasticine-face=""><path fill="#FFFFFF"/></g><path fill="#FFFFFF"/>'))
      .toBe('<g data-plasticine-face=""><path fill="var(--bg)"/></g><path fill="#FFFFFF"/>');
  });

  it('队友：身体是选的颜色，眼睛是页面底色；同一个只画一次', async () => {
    const engine = await loadBotEngine();
    const look = { kind: 'mate', character: 'fox', hue: 'indigo' } as const;
    const svg = stillSvg(engine, look, 'idle', 28);
    expect(svg).toContain('var(--hue-indigo)');
    expect(svg).toContain('var(--bg)');
    expect(stillSvg(engine, look, 'idle', 28)).toBe(svg);
  });
});
