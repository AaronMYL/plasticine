import { useMainName } from '../mates/main-identity.tsx';
import { Speaker } from '../mates/speaker.tsx';
import type { LineSpeaker } from '../../api/shared.ts';
import { useId, useState, type ReactNode } from 'react';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { QuoteSelection } from '../../primitives/message/quote-selection.tsx';
import { MessageWidgets } from '../../primitives/message/widgets/index.tsx';
import { FoldRow, StateRow, StepList } from './line-parts.tsx';
import { MessageRow } from './thread-actions.tsx';
import type { Turn, TurnPart, TurnStep } from './timeline.ts';
import { SpaceRevisionCard } from '../spaces/space-revision-card.tsx';
import { MessageAttachments } from '../conversation/message-attachments.tsx';
import { MessageContent } from '../conversation/message-content.tsx';

function Thinking({ part }: { part: Extract<TurnPart, { kind: 'thinking' }> }): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <FoldRow label={part.seconds === null ? '想了一会儿' : `想了 ${part.seconds} 秒`} open={open} controls={id}
        onToggle={() => setOpen((value) => !value)} />
      {open ? <div id={id} className="line-thinking by-ai"><Markdown text={part.text} /></div> : null}
    </>
  );
}

function Steps({ steps, running }: { steps: TurnStep[]; running: boolean }): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <FoldRow label={`${running && steps.some((step) => step.ok === null) ? '在做' : '做了'} ${steps.length} 步`}
        open={open} controls={id}
        onToggle={() => setOpen((value) => !value)} />
      {open ? <StepList id={id} steps={steps} /> : null}
    </>
  );
}

export interface TurnViewProps {
  lineId: string;
  turn: Turn;
  running?: boolean;
  cutOff?: boolean;
  streaming?: string;
  onRetry?: (() => void) | undefined;
  onQuote?: ((seq: number, text: string) => void) | undefined;
  quiet?: boolean;
  speaker?: LineSpeaker | undefined;
  author?: string | undefined;
}

function Part({ part, lineId, running, onQuote, onRetry, author }: Pick<TurnViewProps, 'lineId' | 'onQuote'
  | 'onRetry' | 'author'> & { part: TurnPart; running: boolean }): ReactNode {
  const mainName = useMainName();
  switch (part.kind) {
    case 'space': return <SpaceRevisionCard result={part.result} />;
    case 'answer':
      return <MessageRow seq={part.seq} author={author ?? mainName} text={part.text}>
        <div className="line-answer" data-message-seq={part.seq}>
          <QuoteSelection onQuote={onQuote === undefined ? undefined : (text) => onQuote(part.seq, text)}>
            <MessageContent text={part.text} />
          </QuoteSelection>
          <MessageAttachments ids={part.attachments ?? []} />
        </div>
      </MessageRow>;
    case 'thinking': return <Thinking part={part} />;
    case 'steps': return <Steps steps={part.steps} running={running} />;
    case 'widgets':
      return <>
        <MessageAttachments ids={part.widgets.flatMap((widget) => (widget.kind === 'file' ? [widget.attachmentId]
          : []))} />
        <MessageWidgets lineId={lineId} messageId={`line:${part.seq}`} widgets={part.widgets} />
      </>;
    case 'error':
      return <StateRow kind="err" text={part.text} action={onRetry === undefined ? undefined : (
        <button type="button" className="text-button line-retry" onClick={onRetry}>重试</button>
      )} />;
    case 'stopped': return <StateRow kind="stopped" text="停下了" />;
  }
}

export function TurnView({ lineId, turn, running = false, cutOff = false, streaming = '', onRetry,
  onQuote, quiet = false, speaker, author }: TurnViewProps): ReactNode {
  const parts = quiet ? turn.parts.filter((part) => part.kind !== 'thinking' && part.kind !== 'steps') : turn.parts;
  if (parts.length === 0 && streaming === '' && !(cutOff && !turn.stopped)) {
    return null;
  }
  return (
    <div className="line-turn">
      {speaker !== undefined && (streaming !== '' || parts.some((part) => part.kind === 'answer'))
        ? <Speaker speaker={speaker} /> : null}
      {parts.map((part) => <Part key={`${part.seq}-${part.kind}`} part={part} lineId={lineId}
        running={running} onQuote={onQuote} onRetry={onRetry} author={author} />)}
      {streaming === '' ? null : <div className="line-answer"><Markdown text={streaming} /></div>}
      {!turn.stopped && cutOff && turn.error === null ? <StateRow kind="stopped" text="停下了" /> : null}
    </div>
  );
}
