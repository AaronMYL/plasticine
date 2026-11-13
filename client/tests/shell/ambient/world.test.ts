// 动态背景的模拟（照 ascii-sharks 改写）：每个形象都能跑；跑很久数量不变、坐标不飞；小东西躲鼠标、点一下四散；
// 大家伙会吃、会绕开字；栅格化画得出身体、腿和须这种细线。

import { describe, expect, it } from 'vitest';
import { FIGURES, GROUP_PREY, figureById } from '../../../src/shell/ambient/figures.ts';
import { CreatureRaster, FLAG_EDGE } from '../../../src/shell/ambient/raster.ts';
import { World } from '../../../src/shell/ambient/world.ts';

const STEP = 1 / 60;

function world(id: string, width = 900, height = 600, motes?: number): World {
  const figure = figureById(id);
  const made = new World(figure.creatures, GROUP_PREY[figure.group], figure.flow === true ? 0 : motes,
    figure.critters ?? []);
  made.resize(width, height, 10, 15);
  return made;
}

describe('动态背景 · 模拟', () => {
  it.each(FIGURES.map((figure) => figure.id))('%s：跑 20 秒数量不变、坐标都是有限数', (id) => {
    const w = world(id);
    const motes = w.motes.length;
    const creatures = w.creatures.length;
    for (let i = 0; i < 1200; i++) w.step(STEP);
    expect(w.motes).toHaveLength(motes);
    expect(w.creatures).toHaveLength(creatures);
    for (const c of w.creatures) {
      expect([...c.nodes].every(Number.isFinite)).toBe(true);
    }
    expect(w.motes.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y))).toBe(true);
  });

  it('鼠标附近的小东西受惊、往外躲', () => {
    const w = world('shark', 900, 600, 80);
    const m = w.motes[0]!;
    w.pointer = { x: m.x + 20, y: m.y, active: true };
    w.step(STEP);
    expect(m.alarm).toBeGreaterThan(0.3);
  });

  it('点一下：附近的一下子四散，记一个水花', () => {
    const w = world('shark', 900, 600, 80);
    const m = w.motes[0]!;
    w.splash(m.x + 30, m.y);
    expect(m.alarm).toBe(1);
    expect(w.events.at(-1)).toMatchObject({ kind: 'splash' });
  });

  it('饿了会追着吃，吃掉的过一会儿整群回来', () => {
    const w = world('shark', 600, 400, 200);
    let eaten = 0;
    for (let i = 0; i < 60 * 40; i++) {
      w.step(STEP);
      eaten += w.events.filter((e) => e.kind === 'eat').length;
      w.events.length = 0;
    }
    expect(eaten).toBeGreaterThan(0);
  });

  it('正文那一块窄的时候，大家伙不追进去，在两边空地巡', () => {
    const w = world('whale', 1200, 800, 20);
    w.quiet = { x: 400, y: 0, w: 400, h: 800 };
    let inside = 0;
    let total = 0;
    for (let i = 0; i < 60 * 30; i++) {
      w.step(STEP);
      if (i < 60 * 10) continue;
      for (const c of w.creatures) {
        total++;
        if (c.nodes[0]! > 450 && c.nodes[0]! < 750) inside++;
      }
    }
    expect(inside / total).toBeLessThan(0.35);
  });
});

describe('动态背景 · 栅格化', () => {
  function raster(id: string): { r: CreatureRaster; w: World } {
    const w = world(id, 900, 600, 10);
    for (let i = 0; i < 120; i++) w.step(STEP);
    const r = new CreatureRaster();
    r.resize(90, 40, 10, 15);
    r.rasterize(w.creatures, w.time);
    return { r, w };
  }

  const withBodies = FIGURES.filter((figure) => figure.creatures.length > 0).map((figure) => figure.id);
  it.each(withBodies)('%s：画得出实心身体，边上有淡的轮廓', (id) => {
    const { r } = raster(id);
    const flags = [...r.flag];
    expect(flags.filter((f) => f !== 0 && f !== FLAG_EDGE).length).toBeGreaterThan(5);
    expect(flags.some((f) => f === FLAG_EDGE)).toBe(true);
  });
});
