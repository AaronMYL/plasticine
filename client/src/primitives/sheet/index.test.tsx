import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, type SheetContentState, type SheetVariant } from './index.tsx';

function Harness({ variant, state }: { variant: SheetVariant; state?: SheetContentState }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开记账
      </button>
      <Sheet open={open} variant={variant} title="记账" state={state} error="没读到账本。" onClose={() => setOpen(false)}>
        <p>本月 1,280.00</p>
      </Sheet>
    </>
  );
}

describe('浮层原语', () => {
  it('关着时什么都不画', () => {
    render(<Sheet open={false} variant="panel" title="记账" onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('sheet-scrim')).toBeNull();
  });

  it('电脑上开着：焦点移进面板，面板不是模态', () => {
    render(<Harness variant="panel" />);
    fireEvent.click(screen.getByRole('button', { name: '打开记账' }));
    const dialog = screen.getByRole('dialog', { name: '记账' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByText('本月 1,280.00')).toBeTruthy();
  });

  it('Esc 关闭后焦点回到入口', () => {
    render(<Harness variant="panel" />);
    const opener = screen.getByRole('button', { name: '打开记账' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('中文输入法选字时按 Esc 不关闭', () => {
    const onClose = vi.fn();
    render(<Sheet open variant="panel" title="记账" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('点遮罩关闭，反复开关不留遮罩', () => {
    render(<Harness variant="panel" />);
    const opener = screen.getByRole('button', { name: '打开记账' });
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(opener);
      fireEvent.click(screen.getByTestId('sheet-scrim'));
    }
    expect(screen.queryAllByTestId('sheet-scrim')).toHaveLength(0);
  });

  it('加载中写「正在读…」', () => {
    render(<Sheet open variant="panel" title="记账" state="loading" onClose={() => undefined} />);
    expect(screen.getByText('正在读…')).toBeTruthy();
  });

  it('失败写原因', () => {
    render(<Harness variant="panel" state="failed" />);
    fireEvent.click(screen.getByRole('button', { name: '打开记账' }));
    expect(screen.getByRole('alert').textContent).toBe('没读到账本。');
  });

  it('手机抽屉是模态、带把手', () => {
    const { container } = render(<Sheet open variant="drawer" title="对话" onClose={() => undefined} />);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.sheet-handle')).not.toBeNull();
  });

  it('手机抽屉内 Tab 循环，不能把键盘焦点移到遮罩背后', () => {
    render(<><button type="button">背后的按钮</button>
      <Sheet open variant="drawer" title="编辑" onClose={() => undefined}>
        <input aria-label="正文" /><button type="button">保存</button>
      </Sheet></>);
    const close = screen.getByRole('button', { name: '关掉编辑' });
    const save = screen.getByRole('button', { name: '保存' });
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    screen.getByRole('button', { name: '背后的按钮' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('有多层浮层时 Escape 只关闭最上层', () => {
    const closeBase = vi.fn();
    const closeTop = vi.fn();
    render(<><Sheet open variant="panel" title="工具" onClose={closeBase} />
      <Sheet open variant="drawer" title="历史" onClose={closeTop} /></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledOnce();
    expect(closeBase).not.toHaveBeenCalled();
  });
});
