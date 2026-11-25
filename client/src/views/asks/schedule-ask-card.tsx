import type { ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import type { ScheduleCardPreview } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { FaceAvatar } from '../contacts/contact-avatar.tsx';
import type { AskWork } from './asks-store.ts';
import { AskSource, useAnswerAsk } from './ask-context.tsx';
import './schedule-ask-card.css';

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <div className="schedule-kv"><span className="schedule-k">{label}</span><div>{children}</div></div>;
}

export function ScheduleAskCard({ ask, card }: { ask: AskView; card: ScheduleCardPreview }): ReactNode {
  const live = useLive();
  const answerAsk = useAnswerAsk();
  const work: AskWork | undefined = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true || ask.status !== 'open';
  const head = `${card.when} · ${card.title}`;
  return (
    <section className="schedule-card content-card" aria-label={`${ask.kindLabel}：${head}`}>
      <header className="content-card-head">
        <HueTile hue="rose" icon="clock" />
        <h3 className="content-card-title">{head}</h3>
        <span className="schedule-tag" data-urgent={card.outward}>
          <Icon name={card.outward ? 'lock' : 'check'} size={12} />{ask.kindLabel}
        </span>
      </header>
      <AskSource ask={ask} />
      <div className="schedule-body">
        {card.who === null ? null : (
          <Row label="对谁">
            <span className="schedule-people">
              {card.who.map((name) => <span key={name} className="schedule-person">
                <FaceAvatar name={name} avatar={null} size={20} />{name}</span>)}
            </span>
          </Row>
        )}
        <Row label={card.who === null ? '做什么' : '发什么'}>{card.what}</Row>
        <Row label="什么时候">{card.when}<span className="schedule-note">你所在地的时间</span></Row>
        {card.place === null ? null : <Row label="在哪做">{card.place}</Row>}
        <Row label="结果">{card.report}</Row>
      </div>
      {ask.detail === null ? null : (
        <p className="schedule-warn"><Icon name="alert" size={16} /><span>{ask.detail}</span></p>
      )}
      <footer className="content-card-actions">
        <span className="content-card-note">归「{card.projectName}」</span>
        {ask.status === 'open' ? [...ask.options].reverse().map((option) => (
          <button key={option.id} type="button" disabled={busy}
            className={option === ask.options[0] ? 'primary-button' : 'secondary-button'}
            aria-label={option.recommended ? `${option.label}（推荐）` : undefined}
            onClick={() => void answerAsk(ask, { optionId: option.id })}>{option.label}</button>
        )) : <span className="schedule-answered">{ask.answer?.label ?? '已答'}</span>}
      </footer>
      {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
    </section>
  );
}
