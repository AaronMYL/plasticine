import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchField } from '../../src/primitives/search-field/index.tsx';

function Harness({ onOuterKey }: { onOuterKey: (key: string) => void }) {
  const [value, setValue] = useState('');
  return <div onKeyDown={(event) => onOuterKey(event.key)}>
    <SearchField label="搜笔记" value={value} onChange={setValue} />
  </div>;
}

describe('搜索框（11-14 界面统一：一种）', () => {
  it('左边放大镜；有字时右边出 ×，点了清空、光标留在框里', () => {
    render(<Harness onOuterKey={() => undefined} />);
    const input = screen.getByRole('searchbox', { name: '搜笔记' });
    expect(input.getAttribute('placeholder')).toBe('搜笔记');
    expect(input.closest('.search-field')?.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
    fireEvent.change(input, { target: { value: '配色' } });
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
  });

  it('有字时 Esc 只清空，不往外传；空着再按 Esc 交给外面（比如关浮层）', () => {
    const outer = vi.fn();
    render(<Harness onOuterKey={outer} />);
    const input = screen.getByRole('searchbox', { name: '搜笔记' });
    fireEvent.change(input, { target: { value: '配色' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(outer).toHaveBeenCalledWith('Escape');
  });
});
