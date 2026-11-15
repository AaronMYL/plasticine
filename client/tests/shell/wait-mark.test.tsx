import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WaitMark } from '../../src/shell/wait-mark.tsx';

describe('「等你」记号', () => {
  it('前面一个强调色的点，字是「等你」', () => {
    const { container } = render(<WaitMark />);
    const mark = container.querySelector('.wait-mark');
    expect(mark?.textContent).toBe('等你');
    expect(mark?.querySelector('.dot.dot-accent')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('带件数时写成「等你 n」，可以整个对读屏藏起来', () => {
    const { container } = render(<WaitMark count={3} hidden />);
    const mark = container.querySelector('.wait-mark');
    expect(mark?.textContent).toBe('等你 3');
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
  });
});
