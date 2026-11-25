import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { ConnectCard, noModelConnected } from './connect-card.tsx';

export function useNoModel(): boolean {
  const live = useLive();
  const data = useStore(live.models.store);
  return noModelConnected(data.value?.providers);
}

export function ConnectSheet({ open, pendingText, onConnected, onClose }: { open: boolean; pendingText: string;
  onConnected: () => void; onClose: () => void }): ReactNode {
  const phone = useViewportWidth() < PHONE_BELOW;
  if (!open) return null;
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
