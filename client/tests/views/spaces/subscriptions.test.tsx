import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from '../../../src/shell/routes.ts';
import { chartScale } from '../../../src/primitives/chart/chart-scale.ts';
import { renderApp } from '../../helpers.tsx';

describe('Subscriptions at top of feed', () => {
  it('subscriptions moved to Library; Feed All top no longer shows weekly report banner', async () => {
    await renderApp({ hash: '#/feed', setup: (fake) => fake.control.spaces.seed() });
    await screen.findByRole('region', { name: '条目' });
    expect(screen.queryByRole('region', { name: '订阅' })).toBeNull();
  });
});

async function openSettings(title: string): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: `「${title}」的更多操作` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '订阅设置' }));
}

describe('Subscription settings', () => {
  it('focus and bias changes save only on Save; preprint toggle and schedule follow settings', async () => {
    const app = await renderApp({ hash: '#/books/space/sp_research_2', setup: (fake) => fake.control.spaces.seed() });
    await openSettings('研究周报 · 第 2 期');
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    const save = within(sheet).getByRole('button', { name: '保存' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect((within(sheet).getByRole('switch', { name: '收预印本' }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole('combobox', { name: '哪天' }) as HTMLSelectElement).value).toBe('1');
    fireEvent.click(within(sheet).getByRole('button', { name: '去掉「预测加工」' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '临床应用' }));
    fireEvent.click(within(sheet).getByRole('button', { name: '加关注' }));
    const input = within(sheet).getByRole('textbox', { name: '新的关注' });
    fireEvent.change(input, { target: { value: '工作记忆' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => fireEvent.click(save));
    const sub = await app.api.subscriptions.get('sub_research');
    expect(sub.settings.kind === 'research' ? [sub.settings.topics, sub.settings.focus] : null)
      .toEqual([['记忆巩固', '睡眠', '注意力的神经机制', '工作记忆'], 'clinical']);
  });

  it('subscription settings popover opens from Library subscription page and persists on Save', async () => {
    const app = await renderApp({ hash: '#/library/sub/sub_research', setup: (fake) => fake.control.spaces.seed() });
    await screen.findByRole('heading', { name: '认知与神经科学研究周报' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '「认知与神经科学研究周报」的更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '订阅设置' }));
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    fireEvent.click(within(sheet).getByRole('button', { name: '临床应用' }));
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '保存' })));
    const sub = await app.api.subscriptions.get('sub_research');
    expect(sub.settings.kind === 'research' ? sub.settings.focus : null).toBe('clinical');
    expect(window.location.hash).toBe('#/library/sub/sub_research');
  });

  it('active subscription pauses, then allows Generate now and re-enabling schedule', async () => {
    const app = await renderApp({ hash: '#/books/space/sp_research_2', setup: (fake) => fake.control.spaces.seed() });
    await openSettings('研究周报 · 第 2 期');
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '暂停订阅' })));
    expect((await app.api.subscriptions.get('sub_research')).status).toBe('paused');
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '现在出一期' })));
    expect(within(sheet).getByText('在写了，写好会出现在往期里')).toBeTruthy();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '开定时' })));
    expect((await app.api.subscriptions.get('sub_research')).status).toBe('active');
  });

  it('personal digest settings configure daily and weekly toggles and times', async () => {
    await renderApp({ hash: '#/books/space/sp_daily_1107', setup: (fake) => fake.control.spaces.seed() });
    await openSettings('日报 · 11月7日');
    const sheet = await screen.findByRole('dialog', { name: '个人回顾' });
    expect((within(sheet).getByRole('switch', { name: '出日报' }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole('switch', { name: '出周报' }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getAllByRole('combobox', { name: '几点' })[0] as HTMLSelectElement).value).toBe('08:00');
  });
});

describe('Digest in Home New section', () => {
  it('shows latest letter title and overnight curation count, opening letter on click', async () => {
    await renderApp({ setup: (fake) => {
      fake.control.spaces.seed();
      fake.control.memoryTopics.seed();
    } });
    const section = await screen.findByRole('region', { name: '新的' });
    expect(within(section).getByText('来信：做梦，有了一组数字')).toBeTruthy();
    expect(within(section).getByText(/昨晚整理了 \d+ 条记忆/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: /来信：/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/books/space/sp_letter_dream'));
  });

  it('omits entire section when neither digest nor curation exists', async () => {
    await renderApp();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: '新的' })).toBeNull();
  });
});

describe('Space route and chart ticks', () => {
  it('#/books/space/<id> opens space and round-trips consistently', () => {
    const route = parseHash('#/books/space/sp%201');
    expect(route).toMatchObject({ view: 'books', spaceId: 'sp 1', bookId: null });
    expect(routeHash(route)).toBe('#/books/space/sp%201');
  });

  it('y-axis uses 3 ticks (40/55/70 for 41-71) allowing peak slightly above top; bars start at 0', () => {
    expect(chartScale([41, 44, 43, 52, 63, 71, 69], false)).toEqual({ ticks: [40, 55, 70], min: 40, max: 71 });
    expect(chartScale([3, 8, 12], true).ticks[0]).toBe(0);
  });
});
