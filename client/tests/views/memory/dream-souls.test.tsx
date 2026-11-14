// 第13批：「昨晚整理」最后一组是这一夜主线和队友各自改的 Soul——谁的、改了几处、它写的一句；能看改动、能撤回。
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

it('昨晚整理里列出这一夜自己改过的 Soul，看改动就地展开，撤回以后写「已撤回」', async () => {
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

it('这一夜没有改 Soul：没有这一组', async () => {
  await renderApp({ hash: '#/memory/dream', setup: (fake) => fake.control.memoryTopics.seed() });
  expect(await screen.findByRole('heading', { name: /昨晚整理了/ })).toBeTruthy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('region', { name: 'Soul' })).toBeNull();
});
