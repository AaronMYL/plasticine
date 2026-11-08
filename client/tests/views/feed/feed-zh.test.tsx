// 信息流（第 6 批第 8、9 条）：外语帖显示存好的中文，短帖直接是全文 +「译自英文 · 看原文」；长帖先是中文摘要，
// 「展开」原地展开中文全文、能切原文、能收起；有数据的条目嵌一张注明来源的小图表；抖音收藏总结来的列核心观点；
// 来源管理里能打开抖音收藏的勾选清单，勾好「处理选中的」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp } from '../../helpers.tsx';

const HOUR_MS = 60 * 60 * 1000;
const LONG_EN = 'We handed 4,800 backtested strategies to a model for three months. '.repeat(6);
const LONG_ZH = '我们把 4,800 个回测过的交易策略交给模型跑了三个月。'.repeat(4);

function ago(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR_MS).toISOString();
}

function card(title: string): HTMLElement {
  return within(screen.getByRole('region', { name: '条目' })).getByRole('listitem', { name: title });
}

function seed(fake: FakeApi): void {
  const { feed } = fake.control;
  feed.seedSource({ id: 'src_x2', kind: 'x', label: 'X', ref: 'x:following2' });
  feed.seedSource({ id: 'src_dy', kind: 'douyin', label: '抖音收藏', ref: 'douyin:favorites' });
  const author = { name: 'Lena Park', handle: 'lenapark', avatar: null };
  feed.seedItem({ id: 'f_short', title: 'short', sourceId: 'src_x2', origin: 'feed', author, arrivedAt: ago(1),
    summary: 'Do not lead with numbers.', zh: { state: 'done', lang: 'en', from: '英文', title: null,
      text: '融资时别急着给数字。', digest: null } });
  feed.seedItem({ id: 'f_long', title: 'long', sourceId: 'src_x2', origin: 'feed', author, arrivedAt: ago(2),
    summary: LONG_EN, zh: { state: 'done', lang: 'en', from: '英文', title: null, text: LONG_ZH,
      digest: '简单的规则活下来了。' } });
  feed.seedItem({ id: 'f_chart', title: 'EV sales', origin: 'feed', arrivedAt: ago(3), summary: 'EV sales rose.',
    zh: { state: 'done', lang: 'en', from: '英文', title: '电动车销量回升', text: '电动车销量回升。', digest: null },
    chart: { kind: 'line', caption: '月销量', source: '行业协会月报', points: [{ label: '7月', value: 98 },
      { label: '8月', value: 101 }, { label: '9月', value: 104 }] } });
  feed.seedItem({ id: 'f_dy', title: '普通人做指数定投的三个误区', sourceId: 'src_dy', origin: 'feed', arrivedAt: ago(4),
    author: { name: '理财小课堂', handle: null, avatar: null },
    video: { kind: 'video', durationSeconds: 222, stage: 'summarized', points: ['回撤时停投，等于放弃了定投的意义'],
      related: ['你笔记里记过每月定投'] } });
}

describe('信息流的中文、小图表和抖音收藏', () => {
  it('短的外语帖：直接是中文全文，「看原文」切到原文、再切回译文', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    const short = await waitFor(() => card('short'));
    expect(within(short).getByText('融资时别急着给数字。')).toBeTruthy();
    expect(within(short).getByText('译自英文')).toBeTruthy();
    fireEvent.click(within(short).getByRole('button', { name: '看原文' }));
    expect(within(short).getByText('Do not lead with numbers.')).toBeTruthy();
    fireEvent.click(within(short).getByRole('button', { name: '看译文' }));
    expect(within(short).getByText('融资时别急着给数字。')).toBeTruthy();
  });

  it('长帖：先是中文摘要，「展开」是中文全文，展开后能看原文、能收起', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    const long = await waitFor(() => card('long'));
    expect(within(long).getByText('简单的规则活下来了。')).toBeTruthy();
    expect(within(long).queryByRole('button', { name: '看原文' })).toBeNull();
    fireEvent.click(within(long).getByRole('button', { name: /展开/ }));
    expect(within(long).getByText(LONG_ZH)).toBeTruthy();
    fireEvent.click(within(long).getByRole('button', { name: '看原文' }));
    expect(within(long).getByText(LONG_EN.trim(), { normalizer: (text) => text.trim() })).toBeTruthy();
    fireEvent.click(within(long).getByRole('button', { name: /收起/ }));
    expect(within(long).getByText('简单的规则活下来了。')).toBeTruthy();
  });

  it('有数据的条目嵌一张小图表，说明里写来源；抖音收藏的卡列核心观点和「和你有关」', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    const chart = await waitFor(() => card('EV sales'));
    expect(within(chart).getByText('电动车销量回升')).toBeTruthy();
    expect(within(chart).getByRole('img', { name: /月销量：7月 98/ })).toBeTruthy();
    expect(within(chart).getByText('月销量 · 来源：行业协会月报')).toBeTruthy();
    const douyin = card('普通人做指数定投的三个误区');
    expect(within(douyin).getByText('抖音收藏 · 理财小课堂')).toBeTruthy();
    expect(within(douyin).getByText('视频 3:42 · 已总结')).toBeTruthy();
    expect(within(douyin).getByText('和你有关：你笔记里记过每月定投')).toBeTruthy();
  });

  it('来源管理里打开抖音收藏：勾选后「处理选中的」，处理过的不重复', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    fireEvent.click(await screen.findByRole('button', { name: '加来源或订阅' }));
    fireEvent.click(await screen.findByRole('button', { name: '选收藏' }));
    const sheet = await screen.findByRole('dialog', { name: '抖音收藏' });
    const row = await within(sheet).findByRole('checkbox', { name: '选中 一口气看懂睡眠周期' });
    expect((row as HTMLInputElement).checked).toBe(false);
    expect(within(sheet).getByRole('img', { name: '已总结' })).toBeTruthy();
    expect(within(sheet).getByText(/还有/)).toBeTruthy();
    fireEvent.click(row);
    expect(within(sheet).getAllByRole('status').some((node) => node.textContent?.startsWith('已选'))).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: '处理选中的' }));
    await waitFor(() => expect(within(sheet).getByText(/排上了 \d+ 条/)).toBeTruthy());
  });
});
