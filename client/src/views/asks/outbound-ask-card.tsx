import { useState, type ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import type { OutboundCard } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { AskTag } from '../../primitives/ask-card/index.tsx';
import { GrantFields } from '../outbound/grant-fields.tsx';
import { useOutboundChoices } from '../outbound/use-outbound-choices.ts';
import { validGrant } from '../outbound/outbound-format.ts';
import { TaskCardPreview } from './task-card-preview.tsx';
import { AskSource, useAnswerAsk } from './ask-context.tsx';

export function OutboundAskCard({ ask, card }: { ask: AskView; card: OutboundCard }): ReactNode {
  const live = useLive();
  const answerAsk = useAnswerAsk();
  const choices = useOutboundChoices();
  const cardChoices = { ...choices, bindings: choices.bindings.filter((binding) =>
    binding.kind === 'line' && binding.id === ask.lineId
      || card.grant.scope.kind === 'task' && binding.kind === card.grant.scope.binding.kind
        && binding.id === card.grant.scope.binding.id) };
  const [draft, setDraft] = useState(card.grant);
  const work = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true;
  const allow = ask.options.find((option) => option.id === 'allow' || option.id === 'extend');
  const answer = (optionId: string): void => { void answerAsk(ask, { optionId, outboundGrant: draft }); };
  return <section className="line-ask outbound-card content-card" aria-label={`对外授权：${ask.question}`}>
    <header className="content-card-head"><AskTag ask={ask} /><h3 className="content-card-title">{ask.question}</h3>
    </header>
    <AskSource ask={ask} />
    <p className="outbound-consequence">{ask.detail?.split('\n')[0] ?? '会以你的名义发出，对方会收到，撤不回。'}</p>
    {ask.taskCard === undefined ? null : <TaskCardPreview card={ask.taskCard} />}
    <GrantFields value={draft} onChange={setDraft} choices={cardChoices} disabled={busy} lockActor />
    <div className="content-card-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={() => answer('deny')}>先不</button>
      {card.relatedGrantId === null ? <button type="button" className="secondary-button" disabled={busy}
        onClick={() => answer('revise')}>改一下</button>
        : <button type="button" className="secondary-button" disabled={busy}
          onClick={() => answer('once')}>只发这一次</button>}
      <button type="button" className="primary-button" disabled={busy || !validGrant(draft)}
        onClick={() => answer(allow?.id ?? 'allow')}>{allow?.id === 'extend' ? '加进授权' : '授权并发出'}</button>
    </div>
    {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
  </section>;
}
