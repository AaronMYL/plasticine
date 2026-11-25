import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IconButton } from '../../src/shell/icon-button.tsx';

it('icon-only buttons have accessible name and tooltip and do not submit forms', () => {
  const click = vi.fn();
  render(<form><IconButton icon="copy" label="复制内容" onClick={click} /></form>);
  const button = screen.getByRole('button', { name: '复制内容' });
  expect(button.getAttribute('data-tip')).toBe('复制内容');
  expect(button.getAttribute('type')).toBe('button');
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
});

it('icon buttons preserve disabled state, toggle state, and custom tooltip', () => {
  const click = vi.fn();
  render(<IconButton icon="pin" label="置顶" title="取消置顶" aria-pressed disabled onClick={click} />);
  const button = screen.getByRole('button', { name: '置顶' });
  expect(button.getAttribute('data-tip')).toBe('取消置顶');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
});
