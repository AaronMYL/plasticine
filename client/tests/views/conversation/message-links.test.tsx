import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { MessageContent, splitMessageLinks } from '../../../src/views/conversation/message-content.tsx';

describe('link cards in conversation', () => {
  it('turns standalone-line URLs into cards while keeping inline and code links as text', () => {
    const text = '读这篇 https://example.test/inline\nhttps://example.test/article\n```\nhttps://example.test/code\n```';
    expect(splitMessageLinks(text).filter((part) => part.kind === 'link')).toEqual([
      { kind: 'link', href: 'https://example.test/article', label: '' },
    ]);
  });

  it('external link renders one-line card with server title/site/cover; internal links skip fetch', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    const preview = vi.spyOn(fake.api.links, 'preview').mockResolvedValue({ url: 'https://example.test/article',
      title: '样例文章', site: '示例站', description: '一段简短摘要', image: '/v2/mail-image?sample=1' });
    render(<ApiProvider api={fake.api}><MessageContent text={'https://example.test/article\n[旅行笔记](#/notes/n1)'} />
    </ApiProvider>);
    expect(await screen.findByText('样例文章')).toBeTruthy();
    expect(screen.getByText('示例站')).toBeTruthy();
    expect(screen.queryByText('一段简短摘要')).toBeNull();
    expect(screen.getByRole('link', { name: /样例文章/ }).querySelector('.row-card-mark img')?.getAttribute('src'))
      .toBe('/v2/mail-image?sample=1');
    const internal = screen.getByRole('link', { name: /旅行笔记/ });
    expect(internal.textContent).toContain('笔记');
    expect(internal.getAttribute('href')).toBe('#/notes/n1');
    expect(internal.getAttribute('target')).toBeNull();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('preview failure still keeps clickable original link', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    vi.spyOn(fake.api.links, 'preview').mockRejectedValue(new Error('超时'));
    render(<ApiProvider api={fake.api}><MessageContent text="https://example.test/article" /></ApiProvider>);
    const link = await screen.findByRole('link', { name: /example.test/ });
    expect(link.getAttribute('href')).toBe('https://example.test/article');
  });
});
