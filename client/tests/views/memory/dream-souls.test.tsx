import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

it('last night summary lists self-edited Souls with inline diff and marks Reverted after undo', async () => {
  const app = await renderApp({ hash: '#/memory/dream', setup: (fake) => {
    fake.control.memoryTopics.seed();
    fake.control.souls.ensure('main');
    const before = fake.control.souls.textOf('main') ?? '';
    fake.control.souls.seedSelf('main', `${before}\n\n## 说话\n- 讲到数字带上单位。`, '加了一条：数字带单位。');
  } });
  const group = await screen.findByRole('region', { name: 'Soul' });
  expect(within(group).getByText('Plasticine 的 Soul · 改了 1 处')).toBeTruthy();
  expect(within(group).getByText('加了一条：数字带单位。')).toBeTruthy();
  fireEvent.click(within(group).getByRole('button', { name: '看改动' }));
  expect(await within(group).findByText('- 讲到数字带上单位。')).toBeTruthy();
  fireEvent.click(within(group).getByRole('button', { name: '撤回「Plasticine 的 Soul」这次改动' }));
  expect(await within(group).findByText('已撤回')).toBeTruthy();
  await waitFor(() => expect(app.control.souls.textOf('main')).not.toContain('讲到数字带上单位'));
});

it('omits Soul section when no Soul was edited overnight', async () => {
  await renderApp({ hash: '#/memory/dream', setup: (fake) => fake.control.memoryTopics.seed() });
  expect(await screen.findByRole('heading', { name: /昨晚整理了/ })).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('region', { name: 'Soul' })).toBeNull();
});
