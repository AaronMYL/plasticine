import { useEffect, useState, type ReactNode } from 'react';
import { PlasticineMark } from './plasticine-mark.tsx';
import { WindowDragStrip } from './window-drag-strip.tsx';

export const CONNECT_SHOW_MS = 300;
export const CONNECT_SLOW_MS = 8_000;

export function ConnectingScreen({ error, onRetry }: { error: string | null; onRetry: () => void }): ReactNode {
  const [shown, setShown] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const show = window.setTimeout(() => setShown(true), CONNECT_SHOW_MS);
    const late = window.setTimeout(() => setSlow(true), CONNECT_SLOW_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(late);
    };
  }, []);
  const problem = error ?? (slow ? '过了 8 秒还没有回应' : null);
  if (!shown && problem === null) {
    return <WindowDragStrip />;
  }
  return (
    <div className="connecting">
      <WindowDragStrip />
      <span className="connecting-mark" data-waiting={problem === null}><PlasticineMark size={52} /></span>
      {problem === null ? <p className="connecting-text" role="status">正在连接…</p> : <>
        <p className="connecting-text is-error" role="alert">没连上 Plasticine：{problem}</p>
        <button type="button" className="secondary-button" onClick={onRetry}>重试</button>
      </>}
    </div>
  );
}
