import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WaitMark } from '../../src/shell/wait-mark.tsx';

describe('waiting indicator', () => {
  it('renders accent dot followed by waiting label', () => {
    const { container } = render(<WaitMark />);
    const mark = container.querySelector('.wait-mark');
    expect(mark?.textContent).toBe('等你');
    expect(mark?.querySelector('.dot.dot-accent')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('formats count when provided and supports hiding from screen readers', () => {
    const { container } = render(<WaitMark count={3} hidden />);
    const mark = container.querySelector('.wait-mark');
    expect(mark?.textContent).toBe('等你 3');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });
});
