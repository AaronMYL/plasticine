// 地上的小动物（11-13 Aaron：兔子、狐狸、小狗、猫咪）：各有各的脾气；朝左时画面镜像、宽度不变。水流的水波会散。

import { describe, expect, it } from 'vitest';
import { CRITTER_ART, CRITTER_KINDS, mirrorFrame } from '../../../src/shell/ambient/critter-art.ts';
import { covered, poseOf, relocateCritters } from '../../../src/shell/ambient/critters.ts';
import { figureById, GROUP_PREY } from '../../../src/shell/ambient/figures.ts';
import { World } from '../../../src/shell/ambient/world.ts';

const STEP = 1 / 60;

function land(id: string): World {
  const figure = figureById(id);
  const world = new World(figure.creatures, GROUP_PREY[figure.group], 10, figure.critters ?? []);
  world.resize(1000, 700, 10, 15);
  return world;
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) world.step(STEP);
}

describe('动态背景 · 地上的小动物', () => {
  it('四种各一组，都在画面里', () => {
    for (const id of ['rabbit', 'fox', 'dog', 'cat']) {
      const world = land(id);
      expect(world.critters.length).toBeGreaterThan(1);
      run(world, 10);
      for (const c of world.critters) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(1000);
        expect(c.y).toBeLessThanOrEqual(700);
      }
    }
  });

  it('猫追着动的鼠标，追上了坐下', () => {
    const world = land('cat');
    const cat = world.critters[0]!;
    const target = { x: Math.min(950, cat.x + 200), y: cat.y };
    for (let i = 0; i < 60 * 6; i++) {
      world.pointer = { x: target.x + Math.sin(i / 3) * 4, y: target.y, active: true };
      world.step(STEP);
    }
    expect(Math.hypot(cat.x - target.x, cat.y - target.y)).toBeLessThan(80);
  });

  it('兔子见鼠标凑近就蹦开，头上冒个「!」', () => {
    const world = land('rabbit');
    const rabbit = world.critters[0]!;
    const start = { x: rabbit.x, y: rabbit.y };
    world.pointer = { x: rabbit.x + 40, y: rabbit.y, active: true };
    run(world, 2);
    expect(rabbit.mood?.glyph).toBe('!');
    expect(Math.hypot(rabbit.x - (start.x + 40), rabbit.y - start.y)).toBeGreaterThan(60);
  });

  it('点一下：小狗跑过去', () => {
    const world = land('dog');
    const dog = world.critters[0]!;
    const spot = { x: dog.x > 500 ? dog.x - 300 : dog.x + 300, y: dog.y };
    world.splash(spot.x, spot.y);
    run(world, 4);
    expect(Math.hypot(dog.x - spot.x, dog.y - spot.y)).toBeLessThan(90);
  });

  it('字的位置头一回量出来：压在字上的小动物直接换到空地方；之后歇着的起身走开', () => {
    const world = land('cat');
    // 左边四分之三是一栏一栏的字，右边空着。
    const rects = Array.from({ length: 20 }, (_, i) => ({ x: 20, y: i * 34 + 10, w: 700, h: 22 }));
    world.quietRects = rects;
    for (const c of world.critters) {
      c.x = 300;
      c.y = 300;
      c.mode = 'rest';
    }
    relocateCritters(world, true);
    for (const c of world.critters) expect(covered(rects, c.x, c.y, c.size)).toBe(0);
    const cat = world.critters[0]!;
    cat.x = 300;
    cat.y = 300;
    cat.mode = 'sleep';
    relocateCritters(world, false);
    expect(cat.mode).toBe('wander');
    expect(covered(rects, cat.tx, cat.ty, cat.size)).toBe(0);
  });

  it('走着是走路的样子，睡着是睡觉的样子', () => {
    const world = land('cat');
    const cat = world.critters[0]!;
    cat.mode = 'sleep';
    expect(poseOf(cat)).toBe('sleep');
    cat.mode = 'wander';
    cat.vx = 30;
    expect(poseOf(cat)).toBe('walk');
  });

  it.each(CRITTER_KINDS)('%s：每一帧镜像后宽度一样、括号方向反过来', (kind) => {
    for (const frames of Object.values(CRITTER_ART[kind].frames)) {
      for (const frame of frames) {
        const width = Math.max(...frame.map((row) => row.length));
        const flipped = mirrorFrame(frame);
        expect(flipped.every((row) => row.length === width)).toBe(true);
        expect(mirrorFrame(flipped).map((row) => row.trimEnd())).toEqual(frame.map((row) => row.padEnd(width)
          .trimEnd()));
      }
    }
  });
});

describe('动态背景 · 水流', () => {
  it('只有水流：没有大家伙、没有小东西、没有小动物', () => {
    const figure = figureById('water');
    const world = new World(figure.creatures, GROUP_PREY[figure.group], 0, figure.critters ?? []);
    world.resize(800, 600, 10, 15);
    run(world, 2);
    expect(world.creatures).toHaveLength(0);
    expect(world.motes).toHaveLength(0);
    expect(world.critters).toHaveLength(0);
  });
});
