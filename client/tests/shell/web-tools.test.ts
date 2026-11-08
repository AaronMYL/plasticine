// 网页工具的纯函数（第 2 批「浏览器」）：原生回的数据先过 schema；阅读模式只排读到的字；圈的一块变成引用片。

import { describe, expect, it, vi } from 'vitest';
import { circleQuote, circleResult, imageFile, readerBlocks, thumbnailUrl } from '../../src/shell/web-tools.ts';

describe('网页工具的纯函数', () => {
  it('阅读模式：去掉空行和连着重复的行；短、句末没标点、后面跟着正文的一行是小标题；不删字', () => {
    const blocks = readerBlocks('文章\n文章\n\n冲突从哪里来\n冲突并不罕见。手机在地铁里改了标题，电脑上同时改了正文。\n完。');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '文章' },
      { kind: 'heading', text: '冲突从哪里来' },
      { kind: 'paragraph', text: '冲突并不罕见。手机在地铁里改了标题，电脑上同时改了正文。' },
      { kind: 'paragraph', text: '完。' },
    ]);
  });

  it('阅读模式：正文里有和页面标题一样的一行，从它后面开始（前面的站名、导航不排）', () => {
    expect(readerBlocks('慢工博客\n文章\n同步难题\n第一段正文。', '同步难题')).toEqual([
      { kind: 'paragraph', text: '第一段正文。' }]);
    expect(readerBlocks('没有标题这一行。', '同步难题')).toEqual([{ kind: 'paragraph', text: '没有标题这一行。' }]);
  });

  it('原生回的截图、缩略图、圈一块形状不对：截图和圈一块抛错，缩略图当没有', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => imageFile({ type: 'image/gif', base64: 'AA' }, 'x')).toThrow('原生回的截图格式不对');
    expect(imageFile({ type: 'image/jpeg', base64: 'AAAA' }, '截图').name).toBe('截图.jpg');
    expect(thumbnailUrl({ base64: 'AAAA' })).toBeNull();
    expect(thumbnailUrl(null)).toBeNull();
    expect(circleResult(null)).toBeNull();
    expect(() => circleResult({ text: 1 })).toThrow('原生回的圈一块格式不对');
  });

  it('圈的一块里没有字（圈了一张图）：引用片写明，名字用这一页的标题', () => {
    const quote = circleQuote({ text: '  ', url: 'https://a.com/', title: '一页' }, new Date(0));
    expect(quote.label).toBe('圈自「一页」');
    expect(quote.text).toBe('圈自「一页」\nhttps://a.com/\n\n〔圈的这一块里没有文字〕');
    expect(quote.kind).toBe('object');
  });
});
