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

describe('Sticky note toolbar at top', () => {
  it('uses sticky positioning with page background and 1px --line; unsticks when collapsed/editing', () => {
    const bar = rule(noteAiCss, '.note-command-bar');
    expect(bar).toMatch(/position:\s*sticky;/);
    expect(bar).toMatch(/top:\s*-24px;/);
    expect(bar).toMatch(/background:\s*var\(--layer-page\);/);
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--line\);/);
    expect(rule(noteAiCss, ".note-command-bar[data-expanded='false']")).toMatch(/position:\s*static;/);
    expect(rule(noteAiCss, '.note-command-bar:has(.note-ai-prompt)')).toMatch(/position:\s*static;/);
    expect(rule(notesCss, '.note-pane')).toMatch(/overflow-y:\s*auto;/);
    expect(rule(notesCss, '.note-pane')).toMatch(/scroll-padding-top:\s*var\(--space-2\);/);
  });

  it('writes measured toolbar height to scroll-padding-top and cursor scrollMargin top', () => {
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

  it('editor reads live scrollMargin on every ProseMirror cursor scroll', async () => {
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
