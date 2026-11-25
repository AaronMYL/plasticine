import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_POINTER_EVENT } from '../../src/mac/native-pointer.ts';
import { useDismiss, type DismissReason } from '../../src/shell/use-dismiss.ts';

function Harness({ onDismiss, withAnchor = false }: {
  onDismiss: (reason: DismissReason) => void; withAnchor?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useDismiss({ open, inside: [trigger, panel], anchor: withAnchor ? trigger : undefined, onDismiss: (reason) => {
    onDismiss(reason);
    setOpen(false);
  } });
  return <div>
    <p>外面的字</p>
    <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)}>打开</button>
    {open ? <div ref={panel} role="menu" aria-label="浮层">
      <input aria-label="浮层里的输入框" />
      <input type="search" aria-label="浮层里的搜索框" />
      <div data-testid="浮层里的滚动">里面</div>
    </div> : null}
  </div>;
}

function setup(withAnchor = false): ReturnType<typeof vi.fn> {
  const onDismiss = vi.fn();
  render(<Harness onDismiss={onDismiss} withAnchor={withAnchor} />);
  return onDismiss;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('popover dismiss behavior', () => {
  it('closes on outside pointerdown; ignores presses inside popover or on trigger', () => {
    const onDismiss = setup();
    fireEvent.pointerDown(screen.getByRole('textbox', { name: '浮层里的输入框' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: '打开' }));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText('外面的字'));
    expect(onDismiss).toHaveBeenCalledWith('outside');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still closes via capture listener when outer element stops pointerdown propagation', () => {
    const onDismiss = setup();
    const outside = screen.getByText('外面的字');
    outside.addEventListener('pointerdown', (event) => event.stopPropagation());
    fireEvent.pointerDown(outside);
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('Esc closes and stops propagation without closing outer drawer; ignores IME composition', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const onDismiss = setup();
    const input = screen.getByRole('textbox', { name: '浮层里的输入框' });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledWith('escape');
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outer);
  });

  it('Esc clears non-empty search input inside popover first; second Esc closes popover', () => {
    const onDismiss = setup();
    const search = screen.getByRole('searchbox', { name: '浮层里的搜索框' });
    fireEvent.change(search, { target: { value: '配色' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledWith('escape');
  });

  it('closes on window blur when Mac user clicks underlying native web view', () => {
    const onDismiss = setup();
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(onDismiss).toHaveBeenCalledWith('blur');
  });

  it('closes when Mac native layer reports click on web tab', () => {
    const onDismiss = setup();
    act(() => { window.dispatchEvent(new Event(NATIVE_POINTER_EVENT)); });
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('blurring an inner input without window blur does not close popover', () => {
    const onDismiss = setup();
    const input = screen.getByRole('textbox', { name: '浮层里的输入框' });
    input.focus();
    input.blur();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes on tab switch or hash route change', () => {
    const onDismiss = setup();
    act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(onDismiss).toHaveBeenCalledWith('navigate');
  });

  it('closes when page becomes hidden', () => {
    const onDismiss = setup();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(onDismiss).toHaveBeenCalledWith('hidden');
  });

  it('closes on window resize unless focus is in popover input (mobile keyboard)', () => {
    const onDismiss = setup();
    screen.getByRole('textbox', { name: '浮层里的输入框' }).focus();
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(onDismiss).not.toHaveBeenCalled();
    screen.getByRole('button', { name: '打开' }).focus();
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(onDismiss).toHaveBeenCalledWith('resize');
  });

  it('without anchor, closes on outside scroll but stays open on inner scroll', () => {
    const onDismiss = setup();
    fireEvent.scroll(screen.getByTestId('浮层里的滚动'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.scroll(document);
    expect(onDismiss).toHaveBeenCalledWith('scroll');
  });

  it('with anchor, stays open while anchor is visible and closes when scrolled out of view', () => {
    const onDismiss = setup(true);
    const trigger = screen.getByRole('button', { name: '打开' });
    const rect = vi.spyOn(trigger, 'getBoundingClientRect');
    rect.mockReturnValue(new DOMRect(10, 10, 40, 20));
    fireEvent.scroll(document);
    expect(onDismiss).not.toHaveBeenCalled();
    rect.mockReturnValue(new DOMRect(10, -60, 40, 20));
    fireEvent.scroll(document);
    expect(onDismiss).toHaveBeenCalledWith('scroll');
  });

  it('stops listening after close so further outside clicks do not fire onClose again', () => {
    const onDismiss = setup();
    fireEvent.pointerDown(screen.getByText('外面的字'));
    fireEvent.pointerDown(screen.getByText('外面的字'));
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
