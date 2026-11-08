import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

it('精确记忆链接能读列表页外的整理前原话：只读显示原文和出处', async () => {
  const app = await renderApp({ hash: '#/memory/entries/target', setup: (fake) => {
    for (let index = 0; index < 60; index += 1) {
      fake.control.memory.seed({ id: `other-${index}`, kind: 'interpretation', text: `其他条目 ${index}` });
    }
    fake.control.memory.seed({ id: 'target', kind: 'interpretation', text: '真正引用的解释' });
  } });
  const focus = await screen.findByRole('region', { name: '引用的条目' });
  expect(within(focus).getByText('真正引用的解释')).toBeDefined();
  expect(within(focus).queryByRole('button', { name: '修改' })).toBeNull();
  expect(app.api.memory).toBeDefined();
});
