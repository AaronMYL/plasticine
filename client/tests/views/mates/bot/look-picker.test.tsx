import { describe, expect, it } from 'vitest';
import { MATE_CHARACTERS, MATE_FACES, MATE_VARIANTS } from '../../../../src/api/shared.ts';
import { loadBotEngine } from '../../../../src/views/mates/bot/bot-engine.ts';
import { liveColors, stillSvg, type BotLook } from '../../../../src/views/mates/bot/bot-render.ts';
import { FACE_NAMES, VARIANT_NAMES } from '../../../../src/views/mates/bot/look-names.ts';

const fox: BotLook = { kind: 'mate', character: 'fox', hue: 'teal', variant: 'solid', face: 'cute' };

describe('Art styles and face shapes', () => {
  it('role, style, and face lists match engine and each item has a Chinese label of >= 2 chars', async () => {
    const engine = await loadBotEngine();
    expect([...MATE_CHARACTERS].sort()).toEqual([...engine.SHAPE_IDS].sort());
    expect([...MATE_VARIANTS]).toEqual([...engine.VECTOR_VARIANTS]);
    expect([...MATE_FACES]).toEqual([...engine.FACE_STYLES]);
    for (const id of MATE_VARIANTS) expect(VARIANT_NAMES[id].length).toBeGreaterThanOrEqual(2);
    for (const id of MATE_FACES) expect(FACE_NAMES[id].length).toBeGreaterThanOrEqual(2);
  });

  it('every style and face renders in selected color and changes output when switched', async () => {
    const engine = await loadBotEngine();
    const plain = stillSvg(engine, fox, 'idle', 30);
    for (const variant of MATE_VARIANTS) {
      const svg = stillSvg(engine, { ...fox, variant }, 'idle', 30);
      expect(svg).toContain('var(--hue-teal)');
      if (variant !== 'solid') expect(svg).not.toBe(plain);
    }
    for (const face of MATE_FACES) {
      const svg = stillSvg(engine, { ...fox, face }, 'idle', 30);
      expect(svg).toContain('data-plasticine-face');
      if (face !== 'cute') expect(svg).not.toBe(plain);
    }
  });

  it('when animated, teammate tints body and cute eyes while main swirl uses page background', () => {
    const mate = liveColors({ ...fox, face: 'specs' }) as Record<string, string>;
    expect(mate['--plasticine-fg']).toBe('var(--hue-teal)');
    expect(mate['--plasticine-face']).toBeUndefined();
    const main = liveColors({ kind: 'main', variant: 'neon' }) as Record<string, string>;
    expect(main['--plasticine-fg']).toBe('var(--accent)');
    expect(main['--plasticine-face']).toBe('var(--bg)');
  });

  it('main thread keeps swirl in page background color after changing art style', async () => {
    const engine = await loadBotEngine();
    for (const variant of ['neon', 'origami', 'watercolor'] as const) {
      const svg = stillSvg(engine, { kind: 'main', variant }, 'idle', 28);
      const face = /<g data-plasticine-face="">[\s\S]*?<\/g>/.exec(svg)?.[0] ?? '';
      expect(face).not.toContain('#FFFFFF');
    }
  });
});
