import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import glyphCss from '../../src/shell/glyph.css?raw';
import { RevealMore } from '../../src/shell/reveal-more.tsx';

describe('row trailing overflow button', () => {
  it('renders menu for secondary actions, executing and closing on item click', () => {
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

  it('renders aria-hidden same-width spacer when no secondary actions exist to keep alignment', () => {
    render(<ul><li>一行<RevealMore label="一行的操作" /></li></ul>);
    expect(screen.queryByRole('button', { name: '一行的操作' })).toBeNull();
    const slot = document.querySelector('.reveal-more');
    expect(slot?.tagName).toBe('SPAN');
    expect(slot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('disabled menu items stay listed and cannot be activated', () => {
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

describe('hover rule styles', () => {
  it('eliminates hover-only controls (no opacity:0 spacers, touch display:none, max-height)', () => {
    expect(glyphCss).not.toMatch(/\.reveal(?:-hover)?\s*\{[^}]*opacity:\s*0/);
    expect(glyphCss).not.toMatch(/\.reveal[^{]*\{[^}]*display:\s*none\s*!important/);
    expect(glyphCss).not.toMatch(/max-height:\s*0/);
    expect(glyphCss).not.toMatch(/data-tip-only/);
  });

  it('overflow button and spacer share exact size: 28px square, 36px on touch', () => {
    expect(glyphCss).toMatch(/\.icon-button\.reveal-more\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/);
    expect(glyphCss).toMatch(/\.icon-button\.reveal-more\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/);
  });
});
