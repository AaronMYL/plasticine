import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { IconButton } from '../../src/shell/icon-button.tsx';

it('纯图标操作有可访问名称和提示，不会意外提交表单', () => {
  const click = vi.fn();
  render(<form><IconButton icon="copy" label="复制内容" onClick={click} /></form>);
  const button = screen.getByRole('button', { name: '复制内容' });
  expect(button.getAttribute('data-tip')).toBe('复制内容');
  expect(button.getAttribute('type')).toBe('button');
  expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
});

it('图标按钮保留禁用、切换态与自定义提示', () => {
  const click = vi.fn();
  render(<IconButton icon="pin" label="置顶" title="取消置顶" aria-pressed disabled onClick={click} />);
  const button = screen.getByRole('button', { name: '置顶' });
  expect(button.getAttribute('data-tip')).toBe('取消置顶');
  expect(button.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
});
