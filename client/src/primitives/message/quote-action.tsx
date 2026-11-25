import { useRef, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { Icon } from '../../shell/icons.tsx';
import './quote-selection.css';

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
