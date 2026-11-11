// 加订阅（第 3 批 11-04）：他只给网址（没写协议当 https），名字由服务端从订阅源取；失败保留地址和原请求标识，重试用同一个。
// 第 7 批第 10 条：在「加来源」的「网址」里，加上就关掉对话框，第二栏多一行。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, settle } from '../../helpers.tsx';

it('加来源里只填网址就能加订阅；失败保留地址并显示服务器提示，重试沿用原请求', async () => {
  const app = await renderApp({ hash: '#/feed' });
  await settle();
  fireEvent.click(await screen.findByRole('button', { name: '加来源' }));
  const form = await screen.findByRole('form', { name: '加订阅' });
  expect(within(form).queryByRole('textbox', { name: '来源名字' })).toBeNull();
  fireEvent.change(within(form).getByRole('textbox', { name: '网站或订阅地址' }),
    { target: { value: 'news.example.test' } });
  const subscribe = vi.spyOn(app.api.feed, 'subscribe').mockRejectedValueOnce(new Error('这个网站没有订阅源'));
  fireEvent.click(within(form).getByRole('button', { name: '添加' }));
  await waitFor(() => expect(form.textContent).toContain('这个网站没有订阅源'));
  // 没写协议补了 https；没加上时框里留着发出去的那个地址，重试用同一个请求。
  expect(within(form).getByRole('textbox', { name: '网站或订阅地址' })).toHaveProperty('value',
    'https://news.example.test');
  fireEvent.click(within(form).getByRole('button', { name: '添加' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '加来源' })).toBeNull());
  const column = screen.getByRole('complementary', { name: '阅读' });
  expect(await within(column).findByRole('button', { name: /^news\.example\.test/ })).toBeTruthy();
  expect(subscribe.mock.calls[0]?.[0]).toMatchObject({ url: 'https://news.example.test' });
  expect(subscribe.mock.calls[1]?.[0].requestId).toBe(subscribe.mock.calls[0]?.[0].requestId);
  expect((await app.api.feed.sources()).others.some((source) => source.kind === 'rss'
    && source.query === 'https://news.example.test')).toBe(true);
});
