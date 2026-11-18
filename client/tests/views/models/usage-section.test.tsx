// 设置 · AI 最上面的「用量」（11-18）：默认 7 天；四个数、七根柱子（指到上面浮出那一天的数）；按模型 / 按用途；
// 换到今天是 24 根；token 和费用的写法；读不到写一行红字加「再读一次」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { costText, tokenText } from '../../../src/views/models/usage-section.tsx';
import { renderApp } from '../../helpers.tsx';

async function section(): Promise<HTMLElement> {
  const pane = await screen.findByRole('dialog', { name: '设置' });
  return within(pane).findByRole('region', { name: '用量' });
}

describe('AI 用量', () => {
  it('在 AI 页最上面；默认 7 天，四个数、七根柱子；换按用途、换今天', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    const region = await section();
    const models = within(await screen.findByRole('dialog', { name: '设置' })).getByRole('group', { name: '模型设置' });
    expect(region.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(region).getByRole('button', { name: '7 天' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(within(region).getAllByRole('listitem', { name: /token/ })).toHaveLength(7));
    const stats = region.querySelectorAll('.usage-stat dt');
    expect([...stats].map((item) => item.textContent)).toEqual(['请求', '输入', '输出', '估算费用']);
    expect(within(region).getByRole('button', { name: '估算费用的说明' })).toBeTruthy();
    const bar = within(region).getAllByRole('listitem', { name: /token/ }).at(-1);
    expect(bar?.querySelector('[data-tip]')?.getAttribute('data-tip')).toMatch(/· [\d.]+[MK]? token · \d+ 次 · \$/u);
    expect(within(region).getByText('GPT-6 Astra')).toBeTruthy();
    expect(within(region).getByText('没有价格')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: /^按用途/ }));
    expect(within(region).getByText('后台线')).toBeTruthy();
    expect(within(region).getByText(/^41 条 · /u)).toBeTruthy();
    const report = vi.spyOn(app.api.modelUsage, 'report');
    fireEvent.click(within(region).getByRole('button', { name: '今天' }));
    await waitFor(() => expect(within(region).getAllByRole('listitem', { name: /token/ })).toHaveLength(24));
    expect(report).toHaveBeenCalledWith('today', expect.any(String), expect.anything());
  });

  it('读不到：一行红字加「再读一次」，点了再读', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    const report = vi.spyOn(app.api.modelUsage, 'report').mockRejectedValueOnce(new Error('网络断了'));
    fireEvent.click(within(await section()).getByRole('button', { name: '30 天' }));
    const alert = await within(await section()).findByRole('alert');
    expect(alert.textContent).toMatch(/^没读到用量：/u);
    fireEvent.click(within(alert).getByRole('button', { name: '再读一次' }));
    await waitFor(() => expect(report).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect(within(await section()).queryByRole('alert')).toBeNull());
  });

  it('token 写短，费用 100 美元以上写整数，没有价格照写', () => {
    expect([tokenText(311_000_000), tokenText(12_340_000), tokenText(652_000), tokenText(1_200), tokenText(980)])
      .toEqual(['311M', '12.3M', '652K', '1.2K', '980']);
    expect([costText({ cost: 684.4, priced: true }), costText({ cost: 5.2, priced: true }),
      costText({ cost: 0, priced: false })]).toEqual(['$684', '$5.20', '没有价格']);
  });
});
