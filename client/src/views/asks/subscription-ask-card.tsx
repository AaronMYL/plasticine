import type { ReactNode } from 'react';
import type { SubscriptionCardPreview } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { useStore } from '../../state/use-store.ts';
import type { AskWork } from './asks-store.ts';
import { AskSource, useAnswerAsk } from './ask-context.tsx';
import './subscription-ask-card.css';

export function SubscriptionAskCard({ ask, card }: { ask: AskView; card: SubscriptionCardPreview }): ReactNode {
  const live = useLive();
  const answerAsk = useAnswerAsk();
  const work: AskWork | undefined = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true || ask.status !== 'open';
  const issue = card.issueNumber === null ? '样刊' : `第 ${card.issueNumber} 期`;
  return (
    <section className="sub-card content-card" aria-label={`${card.when} · ${card.title}`}>
      <header className="content-card-head">
        <HueTile hue="sky" icon="timer" />
        <div className="sub-card-text">
          <h3 className="content-card-title">{card.when}</h3>
          <a className="sub-card-title" href={`#/books/space/${encodeURIComponent(card.spaceId)}`}
            aria-label={`看${card.title}${issue}`}>{card.title} · {issue}</a>
        </div>
      </header>
      <AskSource ask={ask} />
      <footer className="content-card-actions">
        {ask.status === 'open' ? [...ask.options].reverse().map((option) => (
          <button key={option.id} type="button" disabled={busy}
            className={option === ask.options[0] ? 'primary-button' : 'secondary-button'}
            onClick={() => void answerAsk(ask, { optionId: option.id })}>{option.label}</button>
        )) : <span className="sub-card-answered">{ask.answer?.label ?? '已答'}</span>}
      </footer>
      {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
    </section>
  );
}
