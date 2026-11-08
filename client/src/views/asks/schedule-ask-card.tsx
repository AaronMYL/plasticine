// 对话里的定时卡（《优化清单》第 3 条，设计稿 Plasticine-Schedule）：Plasticine 起草，他点确认才生效。
// 头：图标块 · 「每天 15:00 · 抖音续火花」· 要你授权（以他名义发出的）；身：对谁（名单）· 发什么 · 什么时候（他所在地的时间）·
// 在哪做 · 结果；脚：以他名义发出的常显后果，确认 · 改名单，行尾写归哪个项目。答过了按钮收起，写他选了什么。

import type { ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import type { ScheduleCardPreview } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { FaceAvatar } from '../contacts/contact-avatar.tsx';
import type { AskWork } from './asks-store.ts';
import './schedule-ask-card.css';

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <div className="schedule-kv"><span className="schedule-k">{label}</span><div>{children}</div></div>;
}

export function ScheduleAskCard({ ask, card }: { ask: AskView; card: ScheduleCardPreview }): ReactNode {
  const live = useLive();
  const work: AskWork | undefined = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true || ask.status !== 'open';
  const head = `${card.when} · ${card.title}`;
  return (
    <section className="schedule-card" aria-label={`${ask.kindLabel}：${head}`}>
      <header className="schedule-head">
        <HueTile hue="rose" icon="clock" />
        <h3>{head}</h3>
        <span className="schedule-tag" data-urgent={card.outward}>
          <Icon name={card.outward ? 'lock' : 'check'} size={11} />{ask.kindLabel}
        </span>
      </header>
      <div className="schedule-body">
        {card.who === null ? null : (
          <Row label="对谁">
            <span className="schedule-people">
              {card.who.map((name) => <span key={name} className="schedule-person">
                <FaceAvatar name={name} avatar={null} size={22} />{name}</span>)}
            </span>
          </Row>
        )}
        <Row label={card.who === null ? '做什么' : '发什么'}>{card.what}</Row>
        <Row label="什么时候">{card.when}<span className="schedule-note">你所在地的时间</span></Row>
        {card.place === null ? null : <Row label="在哪做">{card.place}</Row>}
        <Row label="结果">{card.report}</Row>
      </div>
      <footer className="schedule-foot">
        {ask.detail === null ? null : (
          <p className="schedule-warn"><Icon name="alert" size={15} /><span>{ask.detail}</span></p>
        )}
        {ask.status === 'open' ? ask.options.map((option, index) => (
          <button key={option.id} type="button" disabled={busy}
            className={index === 0 ? 'primary-button' : 'secondary-button'}
            aria-label={option.recommended ? `${option.label}（推荐）` : undefined}
            onClick={() => void live.asks.answer(ask, { optionId: option.id })}>{option.label}</button>
        )) : <span className="schedule-answered">{ask.answer?.label ?? '已答'}</span>}
        <span className="schedule-spacer" />
        <span className="schedule-note">归「{card.projectName}」</span>
      </footer>
      {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
    </section>
  );
}
