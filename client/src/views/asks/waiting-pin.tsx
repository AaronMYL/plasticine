import { useState, type ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import { Icon } from '../../shell/icons.tsx';
import { FOCUS_FLASH_MS } from '../../shell/use-focus-message.ts';
import { WaitMark } from '../../shell/wait-mark.tsx';
import { LineAskCard } from './line-ask-card.tsx';
import './conversation-ask.css';

export function locateAsk(root: HTMLElement | null, askId: string): void {
  const card = root?.querySelector<HTMLElement>(`[data-ask-id="${CSS.escape(askId)}"]`);
  if (card === null || card === undefined) return;
  const element = card.closest<HTMLElement>('.line-item') ?? card;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.add('is-focused');
  window.setTimeout(() => element.classList.remove('is-focused'), FOCUS_FLASH_MS);
}

export function WaitingPin({ asks, onLocate }: { asks: readonly AskView[]; onLocate: (askId: string) => void })
  : ReactNode {
  const [open, setOpen] = useState(false);
  if (asks.length === 0) return null;
  return <div className="wait-pin" data-open={open}>
    {open ? <div className="wait-pin-list" role="region" aria-label="这段对话里等你的事">
      {asks.map((ask) => <div key={ask.id} className="wait-pin-item">
        <LineAskCard ask={ask} />
        <button type="button" className="text-button text-button-quiet" onClick={() => {
          setOpen(false);
          onLocate(ask.id);
        }}>在对话里看</button>
      </div>)}
    </div> : null}
    <button type="button" className="wait-pin-row" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <WaitMark count={asks.length} />
      <Icon name={open ? 'chevron-down' : 'chevron-up'} size={14} />
    </button>
  </div>;
}
