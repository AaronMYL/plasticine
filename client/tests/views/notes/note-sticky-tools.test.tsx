// 2026-11-05 第 9 条：笔记写长了往下滚，工具栏固定在编辑区顶上（.note-pane 里 position: sticky），和页面同色的底、
// 底下 1px 细线；锚点跳转 / 查找定位（scroll-padding-top）和光标（ProseMirror 的 scrollMargin）都让开工具栏的高度。
// 写修改要求时整块很高，不固定。

import { render } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import noteAiCss from '../../../src/views/notes/note-ai.css?raw';
import notesCss from '../../../src/views/notes/notes.css?raw';
import { useScrollMargin, useStickyTools, type ScrollMargin } from '../../../src/views/notes/use-sticky-tools.ts';
import { renderApp, seedNote } from '../../helpers.tsx';

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

function Harness({ stuck, onMargin }: { stuck: boolean; onMargin: (margin: ScrollMargin) => void }): ReactNode {
  const bar = useRef<HTMLDivElement>(null);
  const margin = useScrollMargin();
  onMargin(margin);
  useStickyTools(bar, margin, stuck);
  return <div className="note-pane" data-testid="pane">
    <div ref={bar} style={{ position: 'sticky' }} data-testid="bar">工具栏</div>
  </div>;
}

describe('笔记工具栏固定在顶上', () => {
  it('样式：在滚动容器里 sticky 贴顶、页面同色的底、底下 1px --line；收起和写修改要求时不固定', () => {
    const bar = rule(noteAiCss, '.note-command-bar');
    expect(bar).toMatch(/position:\s*sticky;/);
    // sticky 在滚动区的内边距以内算：往上让出内边距，贴到滚动区最上沿。
    expect(bar).toMatch(/top:\s*-24px;/);
    expect(bar).toMatch(/background:\s*var\(--layer-page\);/);
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--line\);/);
    expect(rule(noteAiCss, ".note-command-bar[data-expanded='false']")).toMatch(/position:\s*static;/);
    expect(rule(noteAiCss, '.note-command-bar:has(.note-ai-prompt)')).toMatch(/position:\s*static;/);
    expect(rule(notesCss, '.note-pane')).toMatch(/overflow-y:\s*auto;/);
    expect(rule(notesCss, '.note-pane')).toMatch(/scroll-padding-top:\s*8px;/);
  });

  it('量工具栏的高度：写进滚动容器的 scroll-padding-top，光标的 scrollMargin 顶上让开同样的高度', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(52);
    let margin: ScrollMargin | null = null;
    const { getByTestId, rerender, unmount } = render(<Harness stuck onMargin={(value) => { margin = value; }} />);
    expect(getByTestId('pane').style.getPropertyValue('scroll-padding-top')).toBe('60px');
    expect(margin).toMatchObject({ top: 60, bottom: 5 });
    rerender(<Harness stuck={false} onMargin={(value) => { margin = value; }} />);
    expect(getByTestId('pane').style.getPropertyValue('scroll-padding-top')).toBe('8px');
    expect(margin).toMatchObject({ top: 8 });
    unmount();
    vi.restoreAllMocks();
  });

  it('编辑器拿到的就是这份 scrollMargin（ProseMirror 每次滚光标时现读）', async () => {
    await renderApp({ hash: '#/notes/n1', setup: (fake) => seedNote(fake, 'n1', '# 长笔记\n\n正文') });
    type WithEditor = HTMLElement & { editor?: { view: { someProp: (name: string) => unknown } } };
    const element = await vi.waitFor(() => {
      const found = document.querySelector<WithEditor>('.ProseMirror');
      if (found?.editor === undefined) {
        throw new Error('编辑器还没出来');
      }
      return found;
    });
    const margin = element.editor!.view.someProp('scrollMargin') as ScrollMargin;
    expect(margin).toMatchObject({ top: expect.any(Number), bottom: 5, left: 5, right: 5 });
    expect(element.editor!.view.someProp('scrollThreshold')).toBe(margin);
    expect(document.querySelector('.note-pane .note-command-bar')).not.toBeNull();
  });
});
