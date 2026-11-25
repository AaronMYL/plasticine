import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { networkError } from '../../../src/api/errors.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp, settle } from '../../helpers.tsx';

const TITLE = '同步的三种做法';

function seed(fake: FakeApi): void {
  fake.control.feed.seedSource({ id: 'src_blog', kind: 'rss', label: '慢工博客', query: 'https://blog.example.org/feed' });
  fake.control.feed.seedItem({ id: 'f_long', title: TITLE, sourceId: 'src_blog', origin: 'feed',
    summary: '先说结论：看场景。', hasBody: true, body: [
      { t: 'p', text: '第一段。' },
      { t: 'h', text: '做法一' },
      { t: 'li', text: '甲' },
      { t: 'li', text: '乙' },
      { t: 'quote', text: '引一句。' },
      { t: 'code', text: 'merge(a, b)' },
      { t: 'img', text: '示意图', src: '/v2/mail-image?u=x&e=1&s=y' },
    ] });
  fake.control.feed.seedItem({ id: 'f_short', title: '只有摘要的一篇', sourceId: 'src_blog', origin: 'feed',
    summary: '短。' });
}

function card(title: string): HTMLElement {
  const board = within(screen.getByRole('main')).getByRole('region', { name: '条目' });
  return within(board).getByRole('listitem', { name: title });
}

describe('blog full text', () => {
  it('Read Full expands stored text inline and Collapse returns to summary; hides when absent', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    expect(within(card('只有摘要的一篇')).queryByRole('button', { name: '读全文' })).toBeNull();
    expect(card(TITLE).textContent).toContain('先说结论');
    const get = vi.spyOn(app.api.feed, 'get');
    fireEvent.click(within(card(TITLE)).getByRole('button', { name: '读全文' }));
    await waitFor(() => expect(card(TITLE).querySelector('.feed-article')).not.toBeNull());
    expect(get).toHaveBeenCalledWith('f_long');
    const article = card(TITLE).querySelector<HTMLElement>('.feed-article')!;
    expect(within(article).getByRole('heading', { name: '做法一' })).toBeTruthy();
    expect(within(article).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['甲', '乙']);
    expect(article.querySelector('blockquote')?.textContent).toBe('引一句。');
    expect(article.querySelector('pre code')?.textContent).toBe('merge(a, b)');
    const image = within(article).getByRole('img', { name: '示意图' });
    expect(image.getAttribute('src')).toBe('/v2/mail-image?u=x&e=1&s=y');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.click(within(article).getByRole('button', { name: '查看图片 示意图' }));
    const viewer = await screen.findByRole('dialog', { name: '看图' });
    expect(within(viewer).getByRole('img', { name: '示意图' }).getAttribute('src')).toBe('/v2/mail-image?u=x&e=1&s=y');
    fireEvent.click(within(viewer).getByRole('button', { name: '关掉' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '看图' })).toBeNull());
    expect(card(TITLE).textContent).not.toContain('先说结论');
    fireEvent.click(within(card(TITLE)).getByRole('button', { name: '收起' }));
    expect(card(TITLE).querySelector('.feed-article')).toBeNull();
    expect(card(TITLE).textContent).toContain('先说结论');
  });

  it('full-text load error shows reason and Retry button that loads content on click', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    vi.spyOn(app.api.feed, 'get').mockRejectedValueOnce(networkError('读全文'));
    fireEvent.click(within(card(TITLE)).getByRole('button', { name: '读全文' }));
    const alert = await within(card(TITLE)).findByRole('alert');
    expect(alert.textContent).toContain('读全文：连不上服务。');
    fireEvent.click(within(alert).getByRole('button', { name: '再读一次' }));
    await waitFor(() => expect(card(TITLE).querySelector('.feed-article')).not.toBeNull());
    expect(within(card(TITLE)).queryByRole('alert')).toBeNull();
  });
});
