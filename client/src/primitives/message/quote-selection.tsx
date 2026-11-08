import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import './quote-selection.css';

interface SelectedText {
  text: string;
  left: number;
  top: number;
}

/** 按钮浮在选区旁，不挤动正文；靠近气泡右边或滚动区底部时也完整可点。 */
function quotePosition(element: HTMLElement, selected: DOMRect): { left: number; top: number } {
  const source = element.getBoundingClientRect();
  const visible = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const rect = parent.getBoundingClientRect();
    if (style.overflowX !== 'visible' && style.overflowX !== '') {
      visible.left = Math.max(visible.left, rect.left);
      visible.right = Math.min(visible.right, rect.right);
    }
    if (style.overflowY !== 'visible' && style.overflowY !== '') {
      visible.top = Math.max(visible.top, rect.top);
      visible.bottom = Math.min(visible.bottom, rect.bottom);
    }
  }
  const above = selected.top - 40;
  const top = above >= visible.top + 4 ? above : selected.bottom + 6;
  return { left: Math.max(visible.left + 4, Math.min(selected.left, visible.right - 140)) - source.left,
    top: Math.max(visible.top + 4, Math.min(top, visible.bottom - 38)) - source.top };
}

export function QuoteSelection({ children, onQuote }: {
  children: ReactNode; onQuote?: ((text: string) => void) | undefined;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<SelectedText | null>(null);
  const readSelection = useCallback((): void => {
    const selection = window.getSelection();
    const element = ref.current;
    if (selection === null || element === null || selection.isCollapsed || selection.rangeCount === 0
      || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
      setSelected(null);
      return;
    }
    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const box = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
    setSelected(text === '' ? null : { text, ...(box === null ? { left: 0, top: 0 } : quotePosition(element, box)) });
  }, []);
  useEffect(() => {
    if (onQuote === undefined) return;
    // 手机上 touchend 先发生，原生选区随后才生成；从一开始监听，不能等已有选文才订阅。
    document.addEventListener('selectionchange', readSelection);
    return () => document.removeEventListener('selectionchange', readSelection);
  }, [onQuote, readSelection]);
  return <div ref={ref} className="msg-selection-source" onMouseUp={readSelection}
    onTouchEnd={readSelection} onKeyUp={readSelection}>
    {children}
    {selected === null || onQuote === undefined ? null : <button
      type="button" className="msg-chip msg-selection"
      style={{ left: selected.left, top: selected.top }}
      onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onQuote(selected.text);
        setSelected(null);
        window.getSelection()?.removeAllRanges();
      }}>
      <Icon name="quote" size={14} />
      引用选中文字
    </button>}
  </div>;
}
