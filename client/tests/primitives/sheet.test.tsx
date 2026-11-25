import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, SheetFooter, type SheetContentState, type SheetVariant } from '../../src/primitives/sheet/index.tsx';

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

describe('sheet primitive', () => {
  it('renders nothing when closed', () => {
    render(<Sheet open={false} variant="panel" title="记账" onClose={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('sheet-scrim')).toBeNull();
  });

  it('desktop panel portals to main pane rather than caller column; mobile drawer renders inline', () => {
    const tree = (variant: SheetVariant): ReactNode => (
      <div className="shell">
        <aside data-testid="second-column">
          <Sheet open variant={variant} title="文件夹" onClose={() => undefined}><p>内容</p></Sheet>
        </aside>
        <div className="shell-main-area" data-testid="main-area" />
      </div>
    );
    const desktop = render(tree('panel'));
    const dialog = screen.getByRole('dialog', { name: '文件夹' });
    expect(screen.getByTestId('main-area').contains(dialog)).toBe(true);
    expect(screen.getByTestId('main-area').contains(screen.getByTestId('sheet-scrim'))).toBe(true);
    expect(screen.getByTestId('second-column').contains(dialog)).toBe(false);
    desktop.unmount();
    render(tree('drawer'));
    expect(screen.getByTestId('second-column').contains(screen.getByRole('dialog', { name: '文件夹' }))).toBe(true);
  });

  it('desktop open moves focus into non-modal panel', () => {
    render(<Harness variant="panel" />);
    fireEvent.click(screen.getByRole('button', { name: '打开记账' }));
    const dialog = screen.getByRole('dialog', { name: '记账' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByText('本月 1,280.00')).toBeTruthy();
  });

  it('Esc closes sheet and restores focus to trigger', () => {
    render(<Harness variant="panel" />);
    const opener = screen.getByRole('button', { name: '打开记账' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('Esc during Chinese IME composition does not close sheet', () => {
    const onClose = vi.fn();
    render(<Sheet open variant="panel" title="记账" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking backdrop closes sheet and repeated toggling leaves no stale backdrop', () => {
    render(<Harness variant="panel" />);
    const opener = screen.getByRole('button', { name: '打开记账' });
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(opener);
      fireEvent.click(screen.getByTestId('sheet-scrim'));
    }
    expect(screen.queryAllByTestId('sheet-scrim')).toHaveLength(0);
  });

  it('loading state displays reading message', () => {
    render(<Sheet open variant="panel" title="记账" state="loading" onClose={() => undefined} />);
    expect(screen.getByText('正在读…')).toBeTruthy();
  });

  it('error state displays failure reason', () => {
    render(<Harness variant="panel" state="failed" />);
    fireEvent.click(screen.getByRole('button', { name: '打开记账' }));
    expect(screen.getByRole('alert').textContent).toBe('没读到账本。');
  });

  it('mobile drawer is modal with drag handle', () => {
    const { container } = render(<Sheet open variant="drawer" title="对话" onClose={() => undefined} />);
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.sheet-handle')).not.toBeNull();
  });

  it('mobile drawer traps Tab focus and prevents reaching content behind backdrop', () => {
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

  it('Cancel/Save sit in footer, external form submit works, and footer hides while loading', () => {
    const save = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const { container, rerender } = render(
      <Sheet open variant="panel" title="改名" onClose={() => undefined}
        footer={<><button type="button">取消</button><button type="submit" form="rename">保存</button></>}>
        <form id="rename" onSubmit={save}><input aria-label="名字" /></form>
      </Sheet>,
    );
    const foot = container.querySelector('.sheet-foot');
    expect(foot?.textContent).toBe('取消保存');
    expect(container.querySelector('.sheet-body')?.contains(foot ?? null)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(save).toHaveBeenCalledOnce();
    rerender(<Sheet open variant="panel" title="改名" state="loading" onClose={() => undefined}
      footer={<button type="button">保存</button>} />);
    expect(container.querySelector('.sheet-foot')).toBeNull();
  });

  it('nested form moves buttons to footer via SheetFooter, or renders inline outside sheet', () => {
    const Form = (): ReactNode => <form id="tag"><input aria-label="标签" />
      <SheetFooter><button type="submit" form="tag">加上</button></SheetFooter></form>;
    const { container, unmount } = render(<Sheet open variant="drawer" title="加标签" onClose={() => undefined}>
      <Form /></Sheet>);
    const add = screen.getByRole('button', { name: '加上' });
    expect(add.closest('.sheet-foot')).not.toBeNull();
    expect(add.closest('form')).toBeNull();
    expect(container.ownerDocument.querySelector('.sheet-body .sheet-foot')).toBeNull();
    unmount();
    render(<Form />);
    expect(screen.getByRole('button', { name: '加上' }).closest('.sheet-foot-inline')).not.toBeNull();
  });

  it('stacked sheets close only the topmost sheet on Escape', () => {
    const closeBase = vi.fn();
    const closeTop = vi.fn();
    render(<><Sheet open variant="panel" title="工具" onClose={closeBase} />
      <Sheet open variant="drawer" title="历史" onClose={closeTop} /></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledOnce();
    expect(closeBase).not.toHaveBeenCalled();
  });
});
