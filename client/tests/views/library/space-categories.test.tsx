import { act, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

it('资料库桌面和手机按来源分类，图书笔记与网页归档保留独立入口', async () => {
  await renderApp({ hash: '#/library', width: 390, setup: (fake) => {
    fake.control.spaces.ensureGenerated({ id: 'space-web-demo', category: 'webarchive', bookId: null,
      sourceUrl: 'https://example.com/article', title: '示例网页', html: '<h1>网页正文</h1>' });
    fake.control.spaces.ensureGenerated({ id: 'space-book-demo', category: 'booknote', bookId: 'book_demo',
      sourceUrl: 'book:book_demo:outline', title: '示例书的大纲', html: '<h1>图书笔记</h1>' });
  } });
  const all = await screen.findByRole('region', { name: '全部' });
  expect(await within(all).findByRole('heading', { name: '网页归档' })).toBeTruthy();
  expect(within(all).getByRole('heading', { name: '图书笔记' })).toBeTruthy();
  expect(within(all).getByRole('link', { name: '示例网页' })).toBeTruthy();
  expect(within(all).getByRole('link', { name: '示例书的大纲' })).toBeTruthy();
});

it('桌面侧栏在网页归档写入后即时出现分类，保留其他资料入口', async () => {
  const app = await renderApp({ hash: '#/library', setup: (fake) => fake.control.spaces.seed() });
  const column = await screen.findByRole('complementary', { name: '资料库' });
  await within(column).findByRole('link', { name: /AI 信息流核查/ });
  act(() => { app.control.spaces.ensureGenerated({ id: 'space-live-web', category: 'webarchive', bookId: null,
    sourceUrl: 'https://example.com/live', title: '新归档的网页', html: '<h1>正文</h1>' }); });
  expect(await within(column).findByRole('heading', { name: '网页归档' })).toBeTruthy();
  expect(await within(column).findByRole('link', { name: '新归档的网页' })).toBeTruthy();
});
