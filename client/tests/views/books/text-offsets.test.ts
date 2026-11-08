import { describe, expect, it } from 'vitest';
import { contextAround, reanchor } from '../../../src/views/books/anchor.ts';
import {
  plainText,
  rangeBetween,
  selectionOffsets,
  textOffset,
  UI_ATTRIBUTE,
  wrapBetween,
} from '../../../src/views/books/text-offsets.ts';

const HTML = '<p>余生<em>乾隆<strong>癸未</strong></em>冬</p><p><img data-asset="a" alt="插图">十一月'
  + '<ruby>二<rt>èr</rt></ruby>十</p><blockquote><p>事如春梦了无痕</p></blockquote>';

function chapter(html = HTML): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe('正文下标和 DOM 位置互换', () => {
  it('嵌套的行内标签、插图、注音里，任意一段换成 Range 再换回来下标不变', () => {
    const root = chapter();
    const text = root.textContent ?? '';
    expect(plainText(root)).toBe(text);
    for (let start = 0; start < text.length; start += 1) {
      for (let end = start + 1; end <= text.length; end += 1) {
        const range = rangeBetween(root, start, end);
        expect(range).not.toBeNull();
        expect(selectionOffsets(root, range as Range)).toEqual({ start, end });
        expect(range?.toString()).toBe(text.slice(start, end));
      }
    }
  });

  it('位置落在元素上（第几个子节点）时算它前面的字数；不在正文里是 null', () => {
    const root = chapter();
    const second = root.children[1] as HTMLElement;
    expect(textOffset(root, second, 0)).toBe('余生乾隆癸未冬'.length);
    expect(textOffset(root, root, root.childNodes.length)).toBe((root.textContent ?? '').length);
    expect(textOffset(root, document.createElement('p'), 0)).toBeNull();
  });

  it('套高亮跨段落也只切文字节点，textContent 一个字不变；重叠的嵌在里面', () => {
    const root = chapter();
    const before = root.textContent;
    const outer = wrapBetween(root, 2, 12, () => document.createElement('mark'));
    expect(outer.length).toBeGreaterThan(1);
    expect(outer.map((element) => element.textContent).join('')).toBe((before ?? '').slice(2, 12));
    const inner = wrapBetween(root, 4, 6, () => document.createElement('span'));
    expect(inner.map((element) => element.textContent).join('')).toBe('癸未');
    expect(inner[0]?.closest('mark')).not.toBeNull();
    expect(root.textContent).toBe(before);
  });

  it('界面插进正文的角标不算字：下标照原文算', () => {
    const root = chapter('<p>甲乙丙</p>');
    const mark = document.createElement('sup');
    mark.setAttribute(UI_ATTRIBUTE, '');
    mark.textContent = '1';
    root.querySelector('p')?.insertBefore(mark, root.querySelector('p')?.firstChild?.nextSibling ?? null);
    expect(plainText(root)).toBe('甲乙丙');
    const range = rangeBetween(root, 1, 3) as Range;
    expect(selectionOffsets(root, range)).toEqual({ start: 1, end: 3 });
  });
});

describe('高亮重新对上原文', () => {
  const text = '甲乙丙。事如春梦了无痕，苟不记之笔墨。又一句事如春梦了无痕。';

  it('下标处还是原句就原样用', () => {
    const start = text.indexOf('事如春梦');
    expect(reanchor(text, { start, end: start + 7, quote: '事如春梦了无痕' })).toEqual({ start, end: start + 7 });
  });

  it('下标偏了：先找前文 + 原句 + 后文', () => {
    const second = text.lastIndexOf('事如春梦了无痕');
    const anchor = { start: 0, end: 7, quote: '事如春梦了无痕', prefix: '又一句', suffix: '。' };
    expect(reanchor(text, anchor)).toEqual({ start: second, end: second + 7 });
  });

  it('前后文也对不上：找离原位置最近的那一处原句', () => {
    const first = text.indexOf('事如春梦了无痕');
    const anchor = { start: first + 3, end: first + 10, quote: '事如春梦了无痕', prefix: '不存在的前文', suffix: '' };
    expect(reanchor(text, anchor)).toEqual({ start: first, end: first + 7 });
  });

  it('原文里没有这一句就不画（null）', () => {
    expect(reanchor(text, { start: 0, end: 3, quote: '换了版本删掉的话' })).toBeNull();
  });

  it('新划的一段前后各留最多 32 字', () => {
    const long = '字'.repeat(40) + '原句' + '后'.repeat(40);
    const { prefix, suffix } = contextAround(long, 40, 42);
    expect(prefix).toBe('字'.repeat(32));
    expect(suffix).toBe('后'.repeat(32));
  });
});
