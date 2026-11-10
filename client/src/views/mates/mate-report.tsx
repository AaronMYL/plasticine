import type { ReactNode } from 'react';
import type { LineMessageView } from '../../api/shared.ts';
import { MAIN_LINE_ALIAS } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { QuoteSelection } from '../../primitives/message/quote-selection.tsx';
import { MessageAttachments } from '../conversation/message-attachments.tsx';
import { MessageContent } from '../conversation/message-content.tsx';
import { MessageRow } from '../lines/thread-actions.tsx';
import { MateAvatar } from './mate-avatar.tsx';

export function MateReport({ message, onQuote }: { message: LineMessageView;
  onQuote: (seq: number, text: string, author: string) => void }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const child = useStore(live.lines.thread(message.childLineId ?? MAIN_LINE_ALIAS)).line;
  const mate = roster.mates.find((candidate) => candidate.id === child?.mateId);
  const author = mate?.name ?? (child?.mateId != null ? '队友' : child === null ? '工作回复' : 'Plasticine');
  return <MessageRow seq={message.seq} author={author} text={message.text}>
    {mate === undefined ? null : <div className="mate-report-author"><MateAvatar mate={mate} size={24} />
      <span>{mate.name}</span></div>}
    <div className="line-answer" data-message-seq={message.seq}>
      <QuoteSelection onQuote={(text) => onQuote(message.seq, text, author)}>
        <MessageContent text={message.text} />
      </QuoteSelection>
      <MessageAttachments ids={message.attachments} />
    </div>
  </MessageRow>;
}
