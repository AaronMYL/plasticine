import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

const main = (): HTMLElement => screen.getByRole('main');

function moved(fake: FakeApi): void {
  fake.control.memoryTopics.seed();
  fake.control.memoryTopics.moveLayers(['周末不排任何工作提醒', '晚上十点以后'], new Date());
}

describe('Memory - Migration log', () => {
  it('hides migration banner on directory when nothing was migrated', async () => {
    await renderApp({ hash: '#/memory', setup: ({ control }) => control.memoryTopics.seed() });
    await within(main()).findByRole('region', { name: '说好的' });
    expect(within(main()).queryByRole('region', { name: '记忆分层' })).toBeNull();
  });

  it('hides banner and revertible items once migration is older than 7 days', async () => {
    await renderApp({ hash: '#/memory', setup: (fake) => {
      fake.control.memoryTopics.seed();
      fake.control.memoryTopics.moveLayers(['周末不排任何工作提醒'], new Date(Date.now() - 8 * 86_400_000));
    } });
    await within(main()).findByRole('region', { name: '说好的' });
    expect(within(main()).queryByRole('region', { name: '记忆分层' })).toBeNull();
    window.location.hash = '#/memory/layers';
    expect(await within(main()).findByText('现在没有搬过来的记忆。')).toBeTruthy();
  });

  it('shows migration count banner linking to log page with original location per item', async () => {
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

  it('reverting item returns it to original page and empties log page once all are reverted', async () => {
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
