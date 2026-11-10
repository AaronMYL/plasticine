import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { Icon } from '../../shell/icons.tsx';
import './quote-selection.css';

/** 保留节点以完成收起动画；hidden 让键盘与读屏立即离开已失效的选区。 */
export function QuoteAction({ position, fixed = false, onQuote }: {
  position: { left: number; top: number } | null;
  fixed?: boolean;
  onQuote: () => void;
}): ReactNode {
  const last = useRef({ left: 0, top: 0 });
  if (position !== null) last.current = position;
  const [error, setError] = useState<string | null>(null);
  return <div className="quote-action" data-fixed={fixed} hidden={position === null} style={last.current}>
    <button type="button" onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()} onClick={() => {
        setError(null);
        try { onQuote(); } catch (cause) { setError(errorText(cause)); }
      }}><Icon name="quote" size={14} />引用到对话</button>
    {error === null ? null : <span role="alert">{error}</span>}
  </div>;
}
