// 记忆分层的搬家记录（11-15 Aaron 看过设计稿）：搬过以后的 7 天里目录顶上一条「记忆分好层了：搬了 n 条」，「看一下」进
// 记录页——按搬去的那一篇分组，每条下面写原来在哪；每条能单独搬回去，也能全部搬回去。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

const main = (): HTMLElement => screen.getByRole('main');

function moved(fake: FakeApi): void {
  fake.control.memoryTopics.seed();
  // 提示条按真实的今天算摆几天：搬家记成刚刚。
  fake.control.memoryTopics.moveLayers(['周末不排任何工作提醒', '晚上十点以后'], new Date());
}

describe('记忆 · 搬家记录', () => {
  it('没搬过：目录顶上没有这一条', async () => {
    await renderApp({ hash: '#/memory', setup: ({ control }) => control.memoryTopics.seed() });
    await within(main()).findByRole('region', { name: '说好的' });
    expect(within(main()).queryByRole('region', { name: '记忆分层' })).toBeNull();
  });

  it('搬了超过 7 天：提示条没有了，记录页也没有可搬回去的', async () => {
    await renderApp({ hash: '#/memory', setup: (fake) => {
      fake.control.memoryTopics.seed();
      fake.control.memoryTopics.moveLayers(['周末不排任何工作提醒'], new Date(Date.now() - 8 * 86_400_000));
    } });
    await within(main()).findByRole('region', { name: '说好的' });
    expect(within(main()).queryByRole('region', { name: '记忆分层' })).toBeNull();
    window.location.hash = '#/memory/layers';
    expect(await within(main()).findByText('现在没有搬过来的记忆。')).toBeTruthy();
  });

  it('搬过：目录顶上一条写搬了几条，「看一下」进记录页；每条写原来在哪', async () => {
    await renderApp({ hash: '#/memory', setup: moved });
    const banner = await within(main()).findByRole('region', { name: '记忆分层' });
    expect(banner.textContent).toContain('记忆分好层了：搬了 2 条。');
    fireEvent.click(within(banner).getByRole('button', { name: '看一下' }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory/layers'));
    const group = await within(main()).findByRole('region', { name: '搬到「主动告诉你」' });
    const rows = within(group).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('原来在「关于你」')).toBeTruthy();
    expect(within(main()).getByText(/^没动的/).textContent).toMatch(/^没动的 \d+$/);
  });

  it('搬回去一条：回到原来那一篇，记录里少一条；全部搬回去以后这一页没有东西', async () => {
    const app = await renderApp({ hash: '#/memory/layers', setup: moved });
    const group = await within(main()).findByRole('region', { name: '搬到「主动告诉你」' });
    fireEvent.click(within(group).getByRole('button', { name: '搬回去：周末不排任何工作提醒。' }));
    await waitFor(() => expect(within(group).getAllByRole('listitem')).toHaveLength(1));
    const you = await app.api.memoryTopics.get('t_you');
    expect(you.sections.flatMap((section) => section.lines).map((line) => line.text))
      .toContain('周末不排任何工作提醒。');
    fireEvent.click(within(main()).getByRole('button', { name: '全部搬回去' }));
    expect(await within(main()).findByText('现在没有搬过来的记忆。')).toBeTruthy();
    expect((await app.api.memoryTopics.layersMove()).move?.items).toEqual([]);
  });
});
