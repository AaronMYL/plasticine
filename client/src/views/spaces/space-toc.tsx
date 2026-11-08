// 空间右侧的目录（设计稿 Library-Space）：小节标题一列，读到哪一节那一项亮；点了滚到那一节。少于两节不出现。

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { SpaceDoc } from '../../api/shared.ts';

// 小节标题进入视口上方这一段就算「读到这一节」。
const READ_LINE_PX = 120;

export function SpaceToc({ doc, scroller }: { doc: SpaceDoc; scroller: RefObject<HTMLElement | null> }): ReactNode {
  const headings = doc.blocks.flatMap((block) => (block.type === 'heading' ? [block] : []));
  const [current, setCurrent] = useState<string | null>(headings[0]?.id ?? null);
  useEffect(() => {
    const root = scroller.current;
    if (root === null) {
      return undefined;
    }
    const update = (): void => {
      const top = root.getBoundingClientRect().top + READ_LINE_PX;
      let found: string | null = headings[0]?.id ?? null;
      for (const heading of headings) {
        const element = root.querySelector(`#space-${heading.id}`);
        if (element !== null && element.getBoundingClientRect().top <= top) {
          found = heading.id;
        }
      }
      setCurrent(found);
    };
    root.addEventListener('scroll', update, { passive: true });
    return () => root.removeEventListener('scroll', update);
  }, [headings, scroller]);
  if (headings.length < 2) {
    return null;
  }
  return (
    <nav className="space-toc" aria-label="目录">
      {headings.map((heading) => <a key={heading.id} href={`#space-${heading.id}`}
        aria-current={current === heading.id ? 'location' : undefined}
        onClick={(event) => {
          event.preventDefault();
          scroller.current?.querySelector(`#space-${heading.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          setCurrent(heading.id);
        }}>{heading.text}</a>)}
    </nav>
  );
}
