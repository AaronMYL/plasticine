// @vitest-environment-options {"url":"https://you.cyberhunter.top/"}
// 普通网页连远程实例（11-08）：授权完浏览器跳回的 localhost 在这台电脑上、本体收不到，留「贴回调地址」，说明在 ⓘ 里。

import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('普通网页连远程实例的订阅登录', () => {
  it('开授权页，列表下面贴回调地址（ⓘ 说明），贴了连上', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const app = await renderApp({ hash: '#/today', modelConnected: false });
    const page = await screen.findByRole('main', { name: '连接模型' });
    fireEvent.click(within(within(page).getByRole('listitem', { name: 'ChatGPT' })).getByRole('button',
      { name: '登录' }));
    const field = await screen.findByLabelText('回调地址');
    expect(open).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '「粘贴回调地址」的说明' }).getAttribute('aria-description'))
      .toContain('127.0.0.1:1455');
    fireEvent.change(field, { target: { value: 'http://localhost:1455/auth/callback?code=x' } });
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(await screen.findByRole('img', { name: '已连接' })).toBeTruthy();
    expect((await app.api.modelProviders.list()).providers.find((item) => item.id === 'openai')?.connected)
      .toBe('oauth');
  });
});
