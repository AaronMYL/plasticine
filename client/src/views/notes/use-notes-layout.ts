import { useLayoutEffect, useRef, useState } from 'react';

type NotesLayout = 'wide' | 'split' | 'single';

// 三栏留给正文至少 620px；两栏保留 272px 列表、24px 间距和约 460px 正文。
// 观察主区内容宽度，展开对话、拖宽聊天栏或浏览器缩放都会重新分配阅读空间。
const THREE_COLUMNS_MIN = 1120;
const TWO_COLUMNS_MIN = 760;

function layoutFor(width: number): NotesLayout {
  if (width >= THREE_COLUMNS_MIN) return 'wide';
  return width >= TWO_COLUMNS_MIN ? 'split' : 'single';
}

export function useNotesLayout(phone: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const initial = element.getBoundingClientRect().width;
    if (initial > 0) setWidth(initial);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, measured: width !== null, layout: phone ? 'single' as const : layoutFor(width ?? Infinity) };
}
