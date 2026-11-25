import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiMark, StatusGlyph, WeightDot } from '../../src/shell/glyph.tsx';

describe('symbol vocabulary', () => {
  it('sparkle renders no visible text, exposes default or custom screen-reader/tooltip label', () => {
    render(<p><AiMark /> 一句<AiMark label="Plasticine 推断" /></p>);
    const marks = screen.getAllByRole('img');
    expect(marks.map((mark) => mark.getAttribute('aria-label'))).toEqual(['Plasticine 写的', 'Plasticine 推断']);
    expect(marks[0]?.getAttribute('data-tip')).toBe('Plasticine 写的');
    expect(marks[0]?.textContent).toBe('');
  });

  it('status glyph announces waiting, working, pending, done, paused, error, or custom label', () => {
    render(<p>
      <StatusGlyph status="wait" /><StatusGlyph status="run" /><StatusGlyph status="idle" />
      <StatusGlyph status="done" /><StatusGlyph status="pause" /><StatusGlyph status="err" />
      <StatusGlyph status="run" label="Plasticine 在回复" />
    </p>);
    expect(screen.getAllByRole('img').map((glyph) => glyph.getAttribute('aria-label')))
      .toEqual(['等你', '在做', '没开始', '做完', '暂停', '出错', 'Plasticine 在回复']);
    expect(screen.getAllByRole('img').map((glyph) => glyph.dataset['status']))
      .toEqual(['wait', 'run', 'idle', 'done', 'pause', 'err', 'run']);
  });

  it('source dots render solid/half/hollow and announce source only without weight numbers', () => {
    render(<p><WeightDot w={1} /><WeightDot w={0.5} /><WeightDot w={0.1} /></p>);
    const dots = screen.getAllByRole('img');
    expect(dots.map((dot) => dot.dataset['w'])).toEqual(['1', '0.5', '0.1']);
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual(['实际结果', '你说的', 'Plasticine 写的']);
    expect(dots.map((dot) => dot.getAttribute('data-tip'))).toEqual(['实际结果', '你说的', 'Plasticine 写的']);
    expect(dots.every((dot) => dot.hasAttribute('data-tip-tap')), '手机上点一下看来源').toBe(true);
  });
});
