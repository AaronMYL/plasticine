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

describe('search input (unified single variant)', () => {
  it('left magnifier; shows clear button when non-empty, clearing keeps focus in input', () => {
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

  it('Esc clears non-empty input without bubbling; Esc on empty input propagates to parent', () => {
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
