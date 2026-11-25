import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BusyText } from '../../src/primitives/busy/index.tsx';

it('loading keeps hidden label for layout, centers spinner, announces reading; idle shows label', () => {
  const { rerender } = render(<button type="button"><BusyText busy>先看看</BusyText></button>);
  expect(screen.getByRole('status', { name: '正在读' })).toBeTruthy();
  expect(screen.getByText('先看看').getAttribute('aria-hidden')).toBe('true');
  rerender(<button type="button"><BusyText busy={false}>先看看</BusyText></button>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: '先看看' })).toBeTruthy();
});
