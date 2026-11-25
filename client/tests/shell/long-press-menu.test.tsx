import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_MS, useLongPressMenu } from '../../src/shell/long-press-menu.ts';
import { RevealMore } from '../../src/shell/reveal-more.tsx';

function Layer(): ReactNode {
  useLongPressMenu();
  return null;
}

function Row({ onOpen, onRemove }: { onOpen: () => void; onRemove: () => void }): ReactNode {
  return (
    <ul>
      <li>
        <button type="button" onClick={onOpen}>周末买菜</button>
        <RevealMore label="「周末买菜」的更多操作" actions={[{ icon: 'trash', label: '删除', danger: true,
          onSelect: onRemove }]} />
      </li>
    </ul>
  );
}

describe('row menu: overflow button, right-click, and long-press share one menu', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('overflow row is marked right-clickable and button is marked as row menu trigger', () => {
    render(<Row onOpen={vi.fn()} onRemove={vi.fn()} />);
    const more = screen.getByRole('button', { name: '「周末买菜」的更多操作' });
    expect(more.hasAttribute('data-row-menu')).toBe(true);
    expect(more.closest('li')?.hasAttribute('data-context-row')).toBe(true);
  });

  it('touch long-press for 500ms opens row menu and suppresses click on release', () => {
    const open = vi.fn();
    const remove = vi.fn();
    render(<><Layer /><Row onOpen={open} onRemove={remove} /></>);
    const row = screen.getByRole('button', { name: '周末买菜' });
    fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 40, clientY: 20 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(screen.getByRole('menu', { name: '「周末买菜」的更多操作' })).toBeTruthy();
    fireEvent.pointerUp(row, { pointerType: 'touch' });
    fireEvent.click(row);
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('finger movement or short press does not trigger long-press', () => {
    const open = vi.fn();
    render(<><Layer /><Row onOpen={open} onRemove={vi.fn()} /></>);
    const row = screen.getByRole('button', { name: '周末买菜' });
    fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 40, clientY: 20 });
    fireEvent.pointerMove(row, { pointerType: 'touch', clientX: 40, clientY: 60 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.pointerDown(row, { pointerType: 'touch', clientX: 40, clientY: 20 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 100); });
    fireEvent.pointerUp(row, { pointerType: 'touch' });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(row);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('mouse hold does not trigger long-press (mouse uses right-click)', () => {
    render(<><Layer /><Row onOpen={vi.fn()} onRemove={vi.fn()} /></>);
    fireEvent.pointerDown(screen.getByRole('button', { name: '周末买菜' }), { pointerType: 'mouse' });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
