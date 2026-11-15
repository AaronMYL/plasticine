// 打开时「正在连接」（11-15 界面统一，Aaron 弹框定，设计稿「多选、加载、空、正在连接」④）：窗口正中 Plasticine 的标（52，
// 慢慢呼吸，减少动态效果时不动），下面一行「正在连接…」；不到 0.3 秒就连上的什么都不出。8 秒还没连上，或者出错：一行红字
// 说原因，下面「重试」。顶上留一条拖窗口的地方（桌面客户端）。

import { useEffect, useState, type ReactNode } from 'react';
import { PlasticineMark } from './plasticine-mark.tsx';
import { WindowDragStrip } from './window-drag-strip.tsx';

/** 这么久还没连上才出「正在连接…」。 */
export const CONNECT_SHOW_MS = 300;
/** 这么久还没连上就当连不上，给「重试」。 */
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
