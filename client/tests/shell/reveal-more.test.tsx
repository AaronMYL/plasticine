// 行尾 ⋯（2026-11-04 重做悬停）：⋯ 只装这一行的次要操作；说明不再进 ⋯，要补充的用 ⓘ（info-tip.tsx）。
// 一列里有的行有 ⋯、有的没有时，没有的那行留一个看不见的同宽占位，⋯ 列对齐，不时有时无地错位。

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import glyphCss from '../../src/shell/glyph.css?raw';
import { RevealMore } from '../../src/shell/reveal-more.tsx';

describe('行尾 ⋯', () => {
  it('有次要操作：点了出这一行的菜单，点一项就做并收起', () => {
    const archive = vi.fn();
    render(<ul><li>整理访谈稿<RevealMore label="「整理访谈稿」的更多操作" actions={[
      { icon: 'quote', label: '在对话里提', onSelect: () => undefined },
      { icon: 'folder', label: '归档', onSelect: archive },
    ]} /></li></ul>);
    const more = screen.getByRole('button', { name: '「整理访谈稿」的更多操作' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('data-tip')).toBe('更多');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: '「整理访谈稿」的更多操作' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['在对话里提', '归档']);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '归档' }));
    expect(archive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('没有次要操作：不出按钮，只留一个读屏看不见的同宽占位，⋯ 列照样对齐', () => {
    render(<ul><li>一行<RevealMore label="一行的操作" /></li></ul>);
    expect(screen.queryByRole('button', { name: '一行的操作' })).toBeNull();
    const slot = document.querySelector('.reveal-more');
    expect(slot?.tagName).toBe('SPAN');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('菜单项不可用时照样列出、点不动', () => {
    const pause = vi.fn();
    render(<ul><li>一行<RevealMore label="一行的操作" actions={[
      { icon: 'stop', label: '暂停', onSelect: pause, disabled: true },
    ]} /></li></ul>);
    fireEvent.click(screen.getByRole('button', { name: '一行的操作' }));
    const item = screen.getByRole('menuitem', { name: '暂停' });
    expect(item.hasAttribute('disabled')).toBe(true);
    fireEvent.click(item);
    expect(pause).not.toHaveBeenCalled();
  });
});

describe('悬停规则的样式', () => {
  it('不再有「悬停才显示」：没有 opacity: 0 占位、触屏不 display: none、不 max-height 展开', () => {
    expect(glyphCss).not.toMatch(/\.reveal(?:-hover)?\s*\{[^}]*opacity:\s*0/);
    expect(glyphCss).not.toMatch(/\.reveal[^{]*\{[^}]*display:\s*none\s*!important/);
    expect(glyphCss).not.toMatch(/max-height:\s*0/);
    expect(glyphCss).not.toMatch(/data-tip-only/);
  });

  it('⋯ 和它的占位一样大：28 见方，触屏 36', () => {
    expect(glyphCss).toMatch(/\.icon-button\.reveal-more\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/);
    expect(glyphCss).toMatch(/\.icon-button\.reveal-more\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/);
  });
});
