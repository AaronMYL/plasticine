// 非模态浮层全站一套关闭逻辑（2026-11-05 第 3 条）：点外面、Esc、窗口失焦（Mac 里点到原生网页）、切标签 / 换路由、
// 页面藏起、窗口缩放、锚点滚出视野都关；浮层和触发按钮里面按下、浮层里面滚动、在浮层输入框里打字时缩放都不关。

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

describe('浮层的关闭逻辑', () => {
  it('在外面按下就关；在浮层里、在触发按钮上按下不关', () => {
    const onDismiss = setup();
    fireEvent.pointerDown(screen.getByRole('textbox', { name: '浮层里的输入框' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: '打开' }));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText('外面的字'));
    expect(onDismiss).toHaveBeenCalledWith('outside');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('外面的元素在冒泡阶段拦了 pointerdown 也照样关（捕获阶段听）', () => {
    const onDismiss = setup();
    const outside = screen.getByText('外面的字');
    outside.addEventListener('pointerdown', (event) => event.stopPropagation());
    fireEvent.pointerDown(outside);
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('Esc 关，而且不再往外传（外层的抽屉不跟着关）；输入法组字时的 Esc 不算', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const onDismiss = setup();
    const input = screen.getByRole('textbox', { name: '浮层里的输入框' });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledWith('escape');
    // 组字时那一下照常传到外面；关浮层的那一下没传出去。
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outer);
  });

  it('窗口失焦就关：Mac App 里点到垫在下面的原生网页时，主网页只收得到失焦', () => {
    const onDismiss = setup();
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(onDismiss).toHaveBeenCalledWith('blur');
  });

  it('Mac 原生层报「点在网页标签上」就关', () => {
    const onDismiss = setup();
    act(() => { window.dispatchEvent(new Event(NATIVE_POINTER_EVENT)); });
    expect(onDismiss).toHaveBeenCalledWith('outside');
  });

  it('里面的输入框失焦（不是窗口失焦）不关', () => {
    const onDismiss = setup();
    const input = screen.getByRole('textbox', { name: '浮层里的输入框' });
    input.focus();
    input.blur();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('切标签、换路由（地址的 # 变了）就关', () => {
    const onDismiss = setup();
    act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(onDismiss).toHaveBeenCalledWith('navigate');
  });

  it('页面被藏起来就关', () => {
    const onDismiss = setup();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(onDismiss).toHaveBeenCalledWith('hidden');
  });

  it('窗口缩放就关；焦点在浮层的输入框里时不关（手机弹键盘会改视口）', () => {
    const onDismiss = setup();
    screen.getByRole('textbox', { name: '浮层里的输入框' }).focus();
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(onDismiss).not.toHaveBeenCalled();
    screen.getByRole('button', { name: '打开' }).focus();
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(onDismiss).toHaveBeenCalledWith('resize');
  });

  it('没给锚点：外面一滚就关；浮层自己里面滚不关', () => {
    const onDismiss = setup();
    fireEvent.scroll(screen.getByTestId('浮层里的滚动'));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.scroll(document);
    expect(onDismiss).toHaveBeenCalledWith('scroll');
  });

  it('给了锚点：锚点还在视野里不关，滚出视野才关', () => {
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

  it('关上以后不再听：再按外面不会多叫一次', () => {
    const onDismiss = setup();
    fireEvent.pointerDown(screen.getByText('外面的字'));
    fireEvent.pointerDown(screen.getByText('外面的字'));
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
