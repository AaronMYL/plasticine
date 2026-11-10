import { describe, expect, it } from 'vitest';
import { extractPage } from '../../src/mac/extract-page.ts';

describe('网页重点注入', () => {
  it('跨内联元素标出逐字引文，删除重点恢复原文，定位只落在对应正文', () => {
    document.body.innerHTML = '<nav>先沿河走</nav><article><p>先沿河<strong>走，再</strong>进公园。</p></article>';
    const source = document.body.textContent;
    const result = extractPage(document, { kind: 'extract_marks', points: [
      { quote: '先沿河走，再进公园。', context: '先沿河走，再进公园。' }], focus: 0 });
    expect(result).toEqual({ marked: 1 });
    expect(document.querySelector('nav mark')).toBeNull();
    expect(document.querySelectorAll('article mark').length).toBe(3);
    expect(document.body.textContent).toBe(source);
    extractPage(document, { kind: 'extract_marks', points: [] });
    expect(document.querySelector('mark')).toBeNull();
    expect(document.querySelector('strong')?.textContent).toBe('走，再');
  });
  it('只读文章图片与前文位置，不收导航图标或非HTTP资源', () => {
    document.body.innerHTML = '<nav><img src="https://example.com/icon.png"></nav>'
      + '<article><p>河边路线。</p><img src="https://example.com/river.jpg" alt="河边">'
      + '<img src="data:image/png;base64,AAAA"></article>';
    expect(extractPage(document, { kind: 'extract_images' })).toEqual([
      { url: 'https://example.com/river.jpg', alt: '河边', afterText: '河边路线。' },
    ]);
  });
});
