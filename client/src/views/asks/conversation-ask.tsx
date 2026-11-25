import { useState, type ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import { useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { timeText } from '../../shell/time-text.ts';
import { usePlaceText } from './ask-labels.ts';
import type { PlacedAsk } from './conversation-asks.ts';
import { LineAskCard } from './line-ask-card.tsx';
import './conversation-ask.css';

function doneText(ask: AskView): string {
  if (ask.status === 'answered') return ask.answer === null ? '答了' : `选了「${ask.answer.label}」`;
  return ask.status === 'withdrawn' ? '撤回了' : '过期了';
}

function DoneRow({ ask }: { ask: AskView }): ReactNode {
  const timeZone = useTimeZone();
  const placeText = usePlaceText();
  const [open, setOpen] = useState(false);
  const at = ask.answeredAt ?? ask.createdAt;
  const where = ask.status === 'answered' ? placeText(ask.answer?.place) : null;
  const meta = [timeText(at, new Date(), timeZone), where].filter((part) => part !== null);
  return <button type="button" className="ask-done" data-ask-id={ask.id} data-status={ask.status}
    aria-expanded={open} onClick={() => setOpen((value) => !value)}>
    <Icon name={ask.status === 'answered' ? 'check' : 'close'} size={14} />
    <span className="ask-done-question">{ask.question}</span>
    <span className="ask-done-answer">{doneText(ask)}</span>
    <span className="ask-done-meta">{`· ${meta.join(' · ')}`}</span>
  </button>;
}

function DeferredRow({ ask }: { ask: AskView }): ReactNode {
  const [open, setOpen] = useState(false);
  if (open) return <div className="ask-slot" data-ask-id={ask.id}><LineAskCard ask={ask} /></div>;
  return <p className="ask-done" data-ask-id={ask.id} data-status="deferred">
    <Icon name="pin" size={14} />
    <span className="ask-done-question">{ask.question}</span>
    <span className="ask-done-meta">先放着</span>
    <button type="button" className="text-button" onClick={() => setOpen(true)}>现在答</button>
  </p>;
}

export function ConversationAsk({ placed }: { placed: PlacedAsk }): ReactNode {
  const { ask } = placed;
  if (ask.status !== 'open') return <DoneRow ask={ask} />;
  if (ask.deferredAt !== null) return <DeferredRow ask={ask} />;
  return <div className="ask-slot" data-ask-id={ask.id}><LineAskCard ask={ask} /></div>;
}
