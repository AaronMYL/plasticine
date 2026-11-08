// 「点开选一项」的下拉菜单（2026-11-05 第 3 条）：触发按钮报 haspopup / expanded；点外面、Esc、窗口失焦、选完一项都收；
// Esc 和选完后焦点回到按钮（选的那一项自己把焦点交给了别处就不抢）；键盘上下移动、Enter 选、Tab 收起。
// 菜单项是 popover-item（左对齐、不带下划线），不是 text-button。

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

describe('下拉菜单', () => {
  it('点按钮打开菜单，按钮报 aria-haspopup="menu"、aria-expanded；再点一下收起', () => {
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

  it('点正文空白处就收（以前的 <details> 点外面不收）', () => {
    const { trigger, bold } = setup();
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByText('正文'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(bold).not.toHaveBeenCalled();
  });

  it('窗口失焦（Mac 里点到原生网页）就收', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('选一项：做完就收，焦点回到按钮', () => {
    const { trigger, italic } = setup();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '斜体' }));
    expect(italic).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('选的那一项把焦点交给了别处（比如回到正文）：不抢回按钮', () => {
    const { trigger } = setup({ onBold: () => screen.getByRole('textbox', { name: '别处的输入框' }).focus() });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /粗体/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '别处的输入框' }));
  });

  it('点不动的项点了不做、不收', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: '不能用' });
    fireEvent.click(item);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('键盘：按钮上 ↓ 打开并落在第一项，↓ ↑ 移动（跳过点不动的、到头绕回），Enter 选', () => {
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
    // 原生按钮上 Enter 就是点击。
    fireEvent.click(document.activeElement!);
    expect(italic).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('鼠标打开时焦点在菜单本身，方向键照样从第一项开始', () => {
    const { trigger } = setup();
    fireEvent.click(trigger, { detail: 1 });
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(menu);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('粗体⌘B');
  });

  it('Esc 收起，焦点回到按钮', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /粗体/ }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab 收起，焦点回到按钮', () => {
    const { trigger } = setup();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('菜单项样式：左对齐、没有下划线，悬停底色 --tint2', () => {
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
