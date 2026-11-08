// 研究周报样刊附的卡（第 7 批第 14 条，他定；设计稿 Chat-Sample）：头是计时图标块 + 「每周五 08:00 出一期」+ 订阅名，
// 下面链到那一期（站内打开）；脚是「开启定时」（主）「再改改」。点了按钮收起，写他选了什么；结果的确认由服务端写在主线上。

import type { ReactNode } from 'react';
import type { SubscriptionCardPreview } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { HueTile } from '../../shell/hue.tsx';
import { useStore } from '../../state/use-store.ts';
import type { AskWork } from './asks-store.ts';
import './subscription-ask-card.css';

export function SubscriptionAskCard({ ask, card }: { ask: AskView; card: SubscriptionCardPreview }): ReactNode {
  const live = useLive();
  const work: AskWork | undefined = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true || ask.status !== 'open';
  const issue = card.issueNumber === null ? '样刊' : `第 ${card.issueNumber} 期`;
  return (
    <section className="sub-card" aria-label={`${card.when} · ${card.title}`}>
      <header className="sub-card-head">
        <HueTile hue="sky" icon="timer" />
        <div className="sub-card-text">
          <h3 className="sub-card-when">{card.when}</h3>
          <a className="sub-card-title" href={`#/books/space/${encodeURIComponent(card.spaceId)}`}
            aria-label={`看${card.title}${issue}`}>{card.title} · {issue}</a>
        </div>
      </header>
      <footer className="sub-card-foot">
        {ask.status === 'open' ? ask.options.map((option, index) => (
          <button key={option.id} type="button" disabled={busy}
            className={index === 0 ? 'primary-button button-small' : 'secondary-button button-small'}
            onClick={() => void live.asks.answer(ask, { optionId: option.id })}>{option.label}</button>
        )) : <span className="sub-card-answered">{ask.answer?.label ?? '已答'}</span>}
      </footer>
      {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
    </section>
  );
}
