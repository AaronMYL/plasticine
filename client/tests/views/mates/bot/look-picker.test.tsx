// 画风和脸型（11-13 设计稿）：清单和打包进来的引擎一致；每种画风、脸型都画得出来、各缓存各的；
// 队友除萌脸、豆豆眼、线描脸外的脸型用引擎自己的眼白（动起来时不改脸色），主线的漩涡换了画风也还是页面底色。

import { describe, expect, it } from 'vitest';
import { MATE_CHARACTERS, MATE_FACES, MATE_VARIANTS } from '../../../../src/api/shared.ts';
import { loadBotEngine } from '../../../../src/views/mates/bot/bot-engine.ts';
import { liveColors, stillSvg, type BotLook } from '../../../../src/views/mates/bot/bot-render.ts';
import { FACE_NAMES, VARIANT_NAMES } from '../../../../src/views/mates/bot/look-names.ts';

const fox: BotLook = { kind: 'mate', character: 'fox', hue: 'teal', variant: 'solid', face: 'cute' };

describe('画风和脸型', () => {
  it('角色、画风、脸型的清单和引擎一致，每一项都有至少两个字的中文名', async () => {
    const engine = await loadBotEngine();
    expect([...MATE_CHARACTERS].sort()).toEqual([...engine.SHAPE_IDS].sort());
    expect([...MATE_VARIANTS]).toEqual([...engine.VECTOR_VARIANTS]);
    expect([...MATE_FACES]).toEqual([...engine.FACE_STYLES]);
    for (const id of MATE_VARIANTS) expect(VARIANT_NAMES[id].length).toBeGreaterThanOrEqual(2);
    for (const id of MATE_FACES) expect(FACE_NAMES[id].length).toBeGreaterThanOrEqual(2);
  });

  it('每种画风、脸型都画得出来，用的是选的颜色；换了就是另一张', async () => {
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

  it('动起来时：队友只给身体和萌脸眼睛上色，主线的漩涡跟页面底色', () => {
    const mate = liveColors({ ...fox, face: 'specs' }) as Record<string, string>;
    expect(mate['--plasticine-fg']).toBe('var(--hue-teal)');
    expect(mate['--plasticine-face']).toBeUndefined();
    const main = liveColors({ kind: 'main', variant: 'neon' }) as Record<string, string>;
    expect(main['--plasticine-fg']).toBe('var(--accent)');
    expect(main['--plasticine-face']).toBe('var(--bg)');
  });

  it('主线换了画风，漩涡还是页面底色', async () => {
    const engine = await loadBotEngine();
    for (const variant of ['neon', 'origami', 'watercolor'] as const) {
      const svg = stillSvg(engine, { kind: 'main', variant }, 'idle', 28);
      const face = /<g data-plasticine-face="">[\s\S]*?<\/g>/.exec(svg)?.[0] ?? '';
      expect(face).not.toContain('#FFFFFF');
    }
  });
});
