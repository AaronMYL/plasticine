// 用到模型时才连（2026-11-12《首次使用解耦》）：一家模型都没连时，给主线、队友发话先弹这个小窗——电脑是主区里的浮层，
// 手机从底下弹出；里面引着刚才那句，连上以后小窗关掉、那句接着发出去。关掉就算这次不发，原话留在输入框里。

import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { ConnectCard, noModelConnected } from './connect-card.tsx';

/** 现在一家模型都没连（连接状态读到了才算）。 */
export function useNoModel(): boolean {
  const live = useLive();
  const data = useStore(live.models.store);
  return noModelConnected(data.value?.providers);
}

export function ConnectSheet({ open, pendingText, onConnected, onClose }: { open: boolean; pendingText: string;
  onConnected: () => void; onClose: () => void }): ReactNode {
  const phone = useViewportWidth() < PHONE_BELOW;
  if (!open) return null;
  // 挂到 body：输入框是一个 form，小窗里填 key、贴回调各自也是 form，不能套在里面。
  // 一层盖满窗口：主线小窗（z 40）也要压在下面。
  return createPortal(
    <div className="connect-sheet-layer">
      <Sheet open={open} variant={phone ? 'drawer' : 'panel'} modal title="连上一个模型" onClose={onClose}
        className="connect-sheet">
        {pendingText.trim() === '' ? null : (
          <div className="connect-sheet-pending">
            <span className="connect-sheet-note">连上后，这句接着发出</span>
            <blockquote className="connect-sheet-quote">{pendingText}</blockquote>
          </div>
        )}
        <ConnectCard onConnected={onConnected} />
      </Sheet>
    </div>,
    document.body,
  );
}
