import { describe, expect, it, vi } from 'vitest';
import { circleQuote, circleResult, imageFile, readerBlocks, thumbnailUrl } from '../../src/shell/web-tools.ts';

describe('web tool pure helpers', () => {
  it('reader mode strips blank/dup lines, promotes short unpunctuated headings without dropping', () => {
    const blocks = readerBlocks('文章\n文章\n\n冲突从哪里来\n冲突并不罕见。手机在地铁里改了标题，电脑上同时改了正文。\n完。');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '文章' },
      { kind: 'heading', text: '冲突从哪里来' },
      { kind: 'paragraph', text: '冲突并不罕见。手机在地铁里改了标题，电脑上同时改了正文。' },
      { kind: 'paragraph', text: '完。' },
    ]);
  });

  it('reader mode starts after line matching page title to skip leading site nav', () => {
    expect(readerBlocks('慢工博客\n文章\n同步难题\n第一段正文。', '同步难题')).toEqual([
      { kind: 'paragraph', text: '第一段正文。' }]);
    expect(readerBlocks('没有标题这一行。', '同步难题')).toEqual([{ kind: 'paragraph', text: '没有标题这一行。' }]);
  });

  it('malformed screenshot/capture throws; malformed thumbnail returns null', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => imageFile({ type: 'image/gif', base64: 'AA' }, 'x')).toThrow('原生回的截图格式不对');
    expect(imageFile({ type: 'image/jpeg', base64: 'AAAA' }, '截图').name).toBe('截图.jpg');
    expect(thumbnailUrl({ base64: 'AAAA' })).toBeNull();
    expect(thumbnailUrl(null)).toBeNull();
    expect(circleResult(null)).toBeNull();
    expect(() => circleResult({ text: 1 })).toThrow('原生回的圈一块格式不对');
  });

  it('textless capture (e.g. image) labels quote chip with page title', () => {
    const quote = circleQuote({ text: '  ', url: 'https://a.com/', title: '一页' }, new Date(0));
    expect(quote.label).toBe('圈自「一页」');
    expect(quote.text).toBe('圈自「一页」\nhttps://a.com/\n\n〔圈的这一块里没有文字〕');
    expect(quote.kind).toBe('object');
  });
});
