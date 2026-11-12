import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { Icon } from '../../shell/icons.tsx';
import './quote-selection.css';

/**
 * 选中一段后的小条（11-12 第 1 条：全站一个外壳）：「引用 · 复制」。读屏名字仍是「引用到对话」（看得见的「引用」在里面）。
 * 保留节点以完成收起动画；hidden 让键盘与读屏立即离开已失效的选区。
 */
export function QuoteAction({ position, fixed = false, onQuote, onCopy }: {
  position: { left: number; top: number } | null;
  fixed?: boolean;
  onQuote: () => void;
  onCopy?: (() => Promise<void>) | undefined;
}): ReactNode {
  const last = useRef({ left: 0, top: 0 });
  if (position !== null) last.current = position;
  const [error, setError] = useState<string | null>(null);
  const keep = { onPointerDown: (event: { preventDefault: () => void }) => event.preventDefault(),
    onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault() };
  return <div className="quote-action" data-fixed={fixed} hidden={position === null} style={last.current}>
    <div className="quote-action-row">
      <button type="button" aria-label="引用到对话" {...keep} onClick={() => {
        setError(null);
        try { onQuote(); } catch (cause) { setError(errorText(cause)); }
      }}><Icon name="quote" size={14} />引用</button>
      {onCopy === undefined ? null : <button type="button" {...keep} onClick={() => {
        setError(null);
        onCopy().catch((cause: unknown) => setError(errorText(cause)));
      }}><Icon name="copy" size={14} />复制</button>}
    </div>
    {error === null ? null : <span role="alert">{error}</span>}
  </div>;
}
