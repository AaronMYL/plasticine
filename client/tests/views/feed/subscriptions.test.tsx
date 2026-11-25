import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, settle } from '../../helpers.tsx';

it('add-source subscribes by URL alone, keeps URL with error on fail, retries with same ID', async () => {
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
  expect(within(form).getByRole('textbox', { name: '网站或订阅地址' })).toHaveProperty('value',
    'https://news.example.test');
  fireEvent.click(within(form).getByRole('button', { name: '添加' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '加来源' })).toBeNull());
  const column = screen.getByRole('complementary', { name: '阅读' });
  fireEvent.click(await within(column).findByRole('button', { name: /^博客/ }));
  const chips = await within(screen.getByRole('main')).findByRole('group', { name: '看哪一处' });
  expect(within(chips).getByRole('button', { name: /^news\.example\.test/ })).toBeTruthy();
  expect(subscribe.mock.calls[0]?.[0]).toMatchObject({ url: 'https://news.example.test' });
  expect(subscribe.mock.calls[1]?.[0].requestId).toBe(subscribe.mock.calls[0]?.[0].requestId);
  expect((await app.api.feed.sources()).others.some((source) => source.kind === 'rss'
    && source.query === 'https://news.example.test')).toBe(true);
});
