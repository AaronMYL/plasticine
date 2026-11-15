// 按钮里转圈（11-15 设计稿 20 ②）：字留着占位（宽度不变），读屏念「正在读」；不在跑时只有字。

import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { BusyText } from '../../src/primitives/busy/index.tsx';

it('在跑：字还在（看不见、占位），正中一个小圈，读屏念「正在读」；不在跑只有字', () => {
  const { rerender } = render(<button type="button"><BusyText busy>先看看</BusyText></button>);
  expect(screen.getByRole('status', { name: '正在读' })).toBeTruthy();
  expect(screen.getByText('先看看').getAttribute('aria-hidden')).toBe('true');
  rerender(<button type="button"><BusyText busy={false}>先看看</BusyText></button>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: '先看看' })).toBeTruthy();
});
