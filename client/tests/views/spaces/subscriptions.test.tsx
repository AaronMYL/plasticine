// 订阅（《优化清单》第 6、7 条）：信息流顶部的最新一期、订阅浮层（最新一期 / 往期 / 设置）、改设置、开定时要先有样刊、
// 首页「回顾」一节；图表刻度和空间地址。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from '../../../src/shell/routes.ts';
import { chartScale } from '../../../src/views/spaces/chart-scale.ts';
import { renderApp } from '../../helpers.tsx';

describe('信息流顶部的订阅', () => {
  it('只放最新一期的摘要和几个重点；「打开」进那一期空间', async () => {
    await renderApp({ hash: '#/feed', setup: (fake) => fake.control.spaces.seed() });
    const banner = await screen.findByRole('region', { name: '订阅' });
    expect(within(banner).getByText(/^研究周报 · 第 2 期/)).toBeTruthy();
    expect(within(banner).getByText(/睡眠中的记忆重放/)).toBeTruthy();
    expect(within(banner).getByText('14 篇读过 · 5 篇重点 · 2 篇和你有关')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: '打开' }));
    await waitFor(() => expect(window.location.hash).toBe('#/books/space/sp_research_2'));
  });

  it('「订阅」开浮层：最新一期、往期各期、设置；往期点了进那一期', async () => {
    await renderApp({ hash: '#/feed', setup: (fake) => fake.control.spaces.seed() });
    const banner = await screen.findByRole('region', { name: '订阅' });
    fireEvent.click(within(banner).getByRole('button', { name: '订阅' }));
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    expect(within(sheet).getByRole('heading', { name: /睡眠中的记忆重放/ })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: /往期/ }));
    expect(within(sheet).getAllByRole('button', { name: /第 \d 期/ })).toHaveLength(2);
    fireEvent.click(within(sheet).getByRole('button', { name: /第 1 期/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/books/space/sp_research_1'));
  });

  it('还没有研究订阅出过一期：整条不出现', async () => {
    await renderApp({ hash: '#/feed' });
    await screen.findByRole('heading', { name: '信息流' });
    expect(screen.queryByRole('region', { name: '订阅' })).toBeNull();
  });
});

describe('订阅设置', () => {
  it('改关注和偏向：「保存」才存；预印本开关和时间照设置', async () => {
    const app = await renderApp({ hash: '#/books/space/sp_research_2', setup: (fake) => fake.control.spaces.seed() });
    fireEvent.click(await screen.findByRole('button', { name: '订阅设置' }));
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

  it('开着的订阅能暂停；暂停后能「现在出一期」、能重新开定时', async () => {
    const app = await renderApp({ hash: '#/books/space/sp_research_2', setup: (fake) => fake.control.spaces.seed() });
    fireEvent.click(await screen.findByRole('button', { name: '订阅设置' }));
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '暂停订阅' })));
    expect((await app.api.subscriptions.get('sub_research')).status).toBe('paused');
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '现在出一期' })));
    expect(within(sheet).getByText('在写了，写好会出现在往期里')).toBeTruthy();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '开定时' })));
    expect((await app.api.subscriptions.get('sub_research')).status).toBe('active');
  });

  it('个人回顾的设置：日报、周报的开关和时间', async () => {
    await renderApp({ hash: '#/books/space/sp_daily_1107', setup: (fake) => fake.control.spaces.seed() });
    fireEvent.click(await screen.findByRole('button', { name: '订阅设置' }));
    const sheet = await screen.findByRole('dialog', { name: '个人回顾' });
    expect((within(sheet).getByRole('switch', { name: '出日报' }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getByRole('switch', { name: '出周报' }) as HTMLInputElement).checked).toBe(true);
    expect((within(sheet).getAllByRole('combobox', { name: '几点' })[0] as HTMLSelectElement).value).toBe('08:00');
  });
});

describe('首页「回顾」', () => {
  it('最近一期日报的一句、昨晚整理了几条；点了进那一期空间', async () => {
    await renderApp({ setup: (fake) => {
      fake.control.spaces.seed();
      fake.control.memoryTopics.seed();
    } });
    const section = await screen.findByRole('region', { name: '回顾' });
    expect(within(section).getByText('日报：侧栏方案定稿；悬赏还缺赏金来源，卡了三天')).toBeTruthy();
    expect(within(section).getByText(/昨晚整理了 \d+ 条记忆/)).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: /日报：/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/books/space/sp_daily_1107'));
  });

  it('没有回顾也没有整理：整节不出现', async () => {
    await renderApp();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: '回顾' })).toBeNull();
  });
});

describe('空间的地址和图表刻度', () => {
  it('#/books/space/<id> 打开空间，来回一致', () => {
    const route = parseHash('#/books/space/sp%201');
    expect(route).toMatchObject({ view: 'books', spaceId: 'sp 1', bookId: null });
    expect(routeHash(route)).toBe('#/books/space/sp%201');
  });

  it('纵轴三条线：41–71 是 40 / 55 / 70，最高点可以略高过最上一条；柱图从 0 起', () => {
    expect(chartScale([41, 44, 43, 52, 63, 71, 69], false)).toEqual({ ticks: [40, 55, 70], min: 40, max: 71 });
    expect(chartScale([3, 8, 12], true).ticks[0]).toBe(0);
  });
});
