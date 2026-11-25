import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRITTER_ART, CRITTER_KINDS, mirrorFrame } from '../../../src/shell/ambient/critter-art.ts';
import { covered, poseOf, relocateCritters } from '../../../src/shell/ambient/critters.ts';
import { figureById, GROUP_PREY } from '../../../src/shell/ambient/figures.ts';
import { World } from '../../../src/shell/ambient/world.ts';

const STEP = 1 / 60;

function seededRandom(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function land(id: string): World {
  const figure = figureById(id);
  const world = new World(figure.creatures, GROUP_PREY[figure.group], 10, figure.critters ?? []);
  world.resize(1000, 700, 10, 15);
  return world;
}

function run(world: World, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) world.step(STEP);
}

describe('live background: ground animals', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(42));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('spawns one group of each of the four species inside bounds', () => {
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

  it('cat chases moving cursor and sits down once caught', () => {
    const world = land('cat');
    const cat = world.critters[0]!;
    const target = { x: Math.min(950, cat.x + 200), y: cat.y };
    for (let i = 0; i < 60 * 6; i++) {
      world.pointer = { x: target.x + Math.sin(i / 3) * 4, y: target.y, active: true };
      world.step(STEP);
    }
    expect(Math.hypot(cat.x - target.x, cat.y - target.y)).toBeLessThan(80);
  });

  it('rabbit hops away when cursor approaches and shows exclamation mark', () => {
    const world = land('rabbit');
    const rabbit = world.critters[0]!;
    const start = { x: rabbit.x, y: rabbit.y };
    world.pointer = { x: rabbit.x + 40, y: rabbit.y, active: true };
    let startled = false;
    for (let i = 0; i < 2 * 60; i++) {
      world.step(STEP);
      if (rabbit.mood?.glyph === '!') startled = true;
    }
    expect(startled).toBe(true);
    expect(Math.hypot(rabbit.x - (start.x + 40), rabbit.y - start.y)).toBeGreaterThan(60);
  });

  it('clicking makes puppy run toward click location', () => {
    const world = land('dog');
    const dog = world.critters[0]!;
    const spot = { x: dog.x > 500 ? dog.x - 300 : dog.x + 300, y: dog.y };
    world.splash(spot.x, spot.y);
    run(world, 4);
    expect(Math.hypot(dog.x - spot.x, dog.y - spot.y)).toBeLessThan(90);
  });

  it('initial text bounds relocate overlapping animals immediately; later resting ones walk away', () => {
    const world = land('cat');
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

  it('scans entire area to find clear spot when random samples all overlap text', () => {
    const world = land('cat');
    const rects = Array.from({ length: 20 }, (_, i) => ({ x: 20, y: i * 34 + 10, w: 700, h: 22 }));
    world.quietRects = rects;
    for (const c of world.critters) {
      c.x = 300;
      c.y = 300;
    }
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      relocateCritters(world, true);
    } finally {
      random.mockRestore();
    }
    for (const c of world.critters) expect(covered(rects, c.x, c.y, c.size)).toBe(0);
  });

  it('walking state uses walk pose and sleeping state uses sleep pose', () => {
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

describe('live background: water flow', () => {
  it('water-only mode has no large creatures, small particles, or ground animals', () => {
    const figure = figureById('water');
    const world = new World(figure.creatures, GROUP_PREY[figure.group], 0, figure.critters ?? []);
    world.resize(800, 600, 10, 15);
    run(world, 2);
    expect(world.creatures).toHaveLength(0);
    expect(world.motes).toHaveLength(0);
    expect(world.critters).toHaveLength(0);
  });
});
