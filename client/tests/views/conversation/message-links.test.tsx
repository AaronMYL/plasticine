import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { MessageContent, splitMessageLinks } from '../../../src/views/conversation/message-content.tsx';

describe('对话中的链接卡', () => {
  it('只把单独成行的链接变成卡片，句子和代码里的链接保留原文', () => {
    const text = '读这篇 https://example.test/inline\nhttps://example.test/article\n```\nhttps://example.test/code\n```';
    expect(splitMessageLinks(text).filter((part) => part.kind === 'link')).toEqual([
      { kind: 'link', href: 'https://example.test/article', label: '' },
    ]);
  });

  it('外链展示服务端标题、摘要和代理封面，站内对象卡不抓网页', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    const preview = vi.spyOn(fake.api.links, 'preview').mockResolvedValue({ url: 'https://example.test/article',
      title: '样例文章', site: '示例站', description: '一段简短摘要', image: '/v2/mail-image?sample=1' });
    render(<ApiProvider api={fake.api}><MessageContent text={'https://example.test/article\n[旅行笔记](#/notes/n1)'} />
    </ApiProvider>);
    expect(await screen.findByText('样例文章')).toBeTruthy();
    expect(screen.getByText('一段简短摘要')).toBeTruthy();
    expect(screen.getByRole('link', { name: /样例文章/ }).querySelector('.message-link-cover')?.getAttribute('src'))
      .toBe('/v2/mail-image?sample=1');
    const internal = screen.getByRole('link', { name: /旅行笔记/ });
    expect(internal.getAttribute('href')).toBe('#/notes/n1');
    expect(internal.getAttribute('target')).toBeNull();
    expect(preview).toHaveBeenCalledTimes(1);
  });

  it('预览失败仍保留可打开的原始链接', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    vi.spyOn(fake.api.links, 'preview').mockRejectedValue(new Error('超时'));
    render(<ApiProvider api={fake.api}><MessageContent text="https://example.test/article" /></ApiProvider>);
    const link = await screen.findByRole('link', { name: /example.test/ });
    expect(link.getAttribute('href')).toBe('https://example.test/article');
  });
});
