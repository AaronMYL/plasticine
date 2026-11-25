import type { ReactNode } from 'react';
import type { LineMessageView } from '../../api/shared.ts';
import { QuoteSelection } from '../../primitives/message/quote-selection.tsx';
import { Icon } from '../../shell/icons.tsx';
import { inputAuthor } from './line-origin.ts';

export function LineInputRecord({ message, onQuote }: { message: LineMessageView; onQuote: (text: string) => void })
  : ReactNode {
  const author = inputAuthor(message.origin);
  return <details className="line-input-record">
    <summary>
      <Icon name="chevron-right" size={14} />
      <span>{author}{message.origin?.kind === 'delegation' ? ' · 任务指令' : ''}</span>
    </summary>
    <QuoteSelection onQuote={onQuote}><div className="line-input-text">{message.text}</div></QuoteSelection>
  </details>;
}
