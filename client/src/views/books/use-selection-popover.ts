// 正文里选中一段、停下一会儿，弹出「引用到对话 · 四色 · 批注 · 复制」：位置量在 overlay 那一层里（滚动时是正文框，
// 翻页时是阅读区）。正在写批注时不被新的选区顶掉。

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { PopoverState } from './popover-layer.tsx';
import { rangeRects, rectIn } from './reading-scroll.ts';
import { selectionOffsets } from './text-offsets.ts';
import { useQuoteHandler } from '../../shell/quote-registry.ts';
import { CONTEXT_MENU_EVENT } from '../../shell/use-context-menu-close.ts';

// 选区停下多久再弹菜单：拖着选的时候不跟着闪。
const SELECTION_SETTLE_MS = 200;

export function useSelectionPopover(root: HTMLElement | null, overlay: RefObject<HTMLElement | null>,
  setPopover: Dispatch<SetStateAction<PopoverState | null>>): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelection = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const selection = document.getSelection();
        const box = overlay.current;
        if (root === null || box === null || selection === null || selection.rangeCount === 0
          || selection.isCollapsed) {
          return;
        }
        const range = selection.getRangeAt(0);
        const offsets = root.contains(range.commonAncestorContainer) ? selectionOffsets(root, range) : null;
        if (offsets !== null) {
          setPopover((current) => current?.kind === 'note' ? current
            : { kind: 'selection', ...offsets, rect: rectIn(box, rangeRects(range)) });
        }
      }, SELECTION_SETTLE_MS);
    };
    // 右键时收起选中后的菜单：同一时间只出一个浮层（11-12）。
    const onMenu = (): void => {
      clearTimeout(timer);
      setPopover((current) => current?.kind === 'selection' ? null : current);
    };
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener(CONTEXT_MENU_EVENT, onMenu);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelection);
      window.removeEventListener(CONTEXT_MENU_EVENT, onMenu);
    };
  }, [root, overlay, setPopover]);
}

/** 右键「引用到对话」和 ⌘⇧L：选区落在正文里，按原文位置引用（能回到原文）。 */
export function useSelectionQuote(root: HTMLElement | null, enabled: boolean,
  setPopover: Dispatch<SetStateAction<PopoverState | null>>, quote: (start: number, end: number) => void): void {
  useQuoteHandler(() => root, !enabled ? null : (selection) => {
    const range = selection.rangeCount === 0 ? null : selection.getRangeAt(0);
    const offsets = root === null || range === null ? null : selectionOffsets(root, range);
    if (offsets === null) return false;
    setPopover(null);
    quote(offsets.start, offsets.end);
    return true;
  });
}
