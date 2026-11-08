// 拆包（用户视角审查 2026-11-01 第 16 条 ④）：笔记、记忆、成果和工具浮层内容按路由懒加载；等的时候是一句「正在读…」，
// 到了之后页面照常；懒加载的模块里没有那个组件时抛清楚的错，不是白屏。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lazyView } from '../../src/shell/lazy-view.ts';
import { renderApp, settle } from '../helpers.tsx';

describe('按路由懒加载', () => {
  it('工具整页：走到记账时内容懒加载，到了之后主区是记账', async () => {
    await renderApp({ width: 1440 });
    act(() => { window.location.hash = '#/tools/money'; });
    const page = within(screen.getByRole('main'));
    expect(await page.findByRole('heading', { level: 1, name: '记账' })).toBeTruthy();
    await waitFor(() => expect(page.queryByText('正在读…')).toBeNull());
  });

  it('模块里没有那个命名导出：抛一句说清楚的错', async () => {
    const Missing = lazyView(() => Promise.resolve({ Other: () => null }), 'Nope');
    const payload = Missing as unknown as { _payload: { _result: () => Promise<unknown> } };
    await expect(payload._payload._result()).rejects.toThrow('没有「Nope」这个组件');
  });
});
