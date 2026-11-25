import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import popoverCss from '../../src/shell/popover.css?raw';
import { DropdownMenu, SEPARATOR } from '../../src/shell/dropdown-menu.tsx';

function setup(extra: { onBold?: () => void } = {}) {
  const bold = vi.fn(extra.onBold);
  const italic = vi.fn();
  render(<div>
    <p>正文</p>
    <input aria-label="别处的输入框" />
    <DropdownMenu label="文字格式" items={[
      { label: '粗体', shortcut: '⌘B', onSelect: bold },
      SEPARATOR,
      { label: '斜体', onSelect: italic },
      { label: '不能用', onSelect: vi.fn(), disabled: true },
    ]}>格式</DropdownMenu>
  </div>);
  return { bold, italic, trigger: screen.getByRole('button', { name: '文字格式' }) };
}

describe('dropdown menu', () => {
  it('trigger sets aria-haspopup=menu and aria-expanded, toggling menu on click', () => {
    const { trigger } = setup();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: '文字格式' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['粗体⌘B', '斜体', '不能用']);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking outside closes menu', () => {
    const { trigger, bold } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('正文'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(bold).not.toHaveBeenCalled();
  });

  it('window blur closes menu', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('selecting an item runs action, closes menu, and returns focus to trigger', () => {
    const { trigger, italic } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '斜体' }));
    expect(italic).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus back when selected item moves focus elsewhere', () => {
    const { trigger } = setup({ onBold: () => screen.getByRole('textbox', { name: '别处的输入框' }).focus() });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /粗体/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '别处的输入框' }));
  });

  it('clicking disabled item does nothing and keeps menu open', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: '不能用' });
    fireEvent.click(item);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('keyboard Down opens on first item, arrows wrap skipping disabled, Enter selects', () => {
    const { trigger, italic } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    expect(document.activeElement?.textContent).toBe('粗体⌘B');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('斜体');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('粗体⌘B');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement?.textContent).toBe('斜体');
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.click(document.activeElement!);
    expect(italic).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('mouse-opened menu focuses menu container and arrows still start at first item', () => {
    const { trigger } = setup();
    fireEvent.click(trigger, { detail: 1 });
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('粗体⌘B');
  });

  it('Esc closes menu and returns focus to trigger', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /粗体/ }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab closes menu and returns focus to trigger', () => {
    const { trigger } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('menu items are left-aligned, no underline, with --tint2 hover background', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: '斜体' });
    expect(item.classList.contains('popover-item')).toBe(true);
    expect(item.classList.contains('text-button')).toBe(false);
    expect(popoverCss).toMatch(/\.popover-item\s*\{[^}]*text-align:\s*left;/);
    expect(popoverCss).not.toMatch(/\.popover-item[^{]*\{[^}]*text-decoration:\s*underline/);
    expect(popoverCss).toMatch(/\.popover-item:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*var\(--tint2\)/);
  });
});
