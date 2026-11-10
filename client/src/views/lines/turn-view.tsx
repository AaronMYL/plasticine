// Plasticine 的一轮：正文和过程按出现顺序画，过程从开始就有自己的位置，结束只更新内容。正文可选文引用。

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
  /** 这一轮在哪条线上（答卡片小部件发到这条线）。 */
  lineId: string;
  turn: Turn;
  /** 这一轮还在跑：未完成的步骤原位更新，后面接着流式的字。 */
  running?: boolean;
  /** 线已经不在跑，这一轮却停在某一步的结果上：被叫停了（见 Turn.endedOnTool）。 */
  cutOff?: boolean;
  /** 流式出来、还没写进库的字。 */
  streaming?: string;
  /** 出错那一行的「重试」（只有最后一轮、线现在是出错的才给）。 */
  onRetry?: (() => void) | undefined;
  onQuote?: ((seq: number, text: string) => void) | undefined;
  /**
   * 主线和旁聊（《优化清单》第 17 条）：工具日志不进对话——不画「想了 n 秒」「做了 n 步」，只有说给人听的话；
   * 干活时的一行实时状态在下面，子代理的步骤在它的卡片里。
   */
  quiet?: boolean;
}

function Part({ part, lineId, running, onQuote, onRetry }: Pick<TurnViewProps, 'lineId' | 'onQuote' | 'onRetry'>
  & { part: TurnPart; running: boolean }): ReactNode {
  switch (part.kind) {
    case 'space': return <SpaceRevisionCard result={part.result} />;
    case 'answer':
      return <MessageRow seq={part.seq} author="Plasticine" text={part.text}>
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
      return <MessageWidgets lineId={lineId} messageId={`line:${part.seq}`} widgets={part.widgets} />;
    case 'error':
      return <StateRow kind="err" text={part.text} action={onRetry === undefined ? undefined : (
        <button type="button" className="text-button line-retry" onClick={onRetry}>重试</button>
      )} />;
    case 'stopped': return <StateRow kind="stopped" text="停下了" />;
  }
}

export function TurnView({ lineId, turn, running = false, cutOff = false, streaming = '', onRetry,
  onQuote, quiet = false }: TurnViewProps): ReactNode {
  const parts = quiet ? turn.parts.filter((part) => part.kind !== 'thinking' && part.kind !== 'steps') : turn.parts;
  if (parts.length === 0 && streaming === '' && !(cutOff && !turn.stopped)) {
    return null;
  }
  return (
    <div className="line-turn">
      {parts.map((part) => <Part key={`${part.seq}-${part.kind}`} part={part} lineId={lineId}
        running={running} onQuote={onQuote} onRetry={onRetry} />)}
      {streaming === '' ? null : <div className="line-answer"><Markdown text={streaming} /></div>}
      {!turn.stopped && cutOff && turn.error === null ? <StateRow kind="stopped" text="停下了" /> : null}
    </div>
  );
}
