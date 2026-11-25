import { useState, type ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import { useLive } from '../../live.tsx';
import { AskTag } from '../../primitives/ask-card/index.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { DeviceActionCard } from '../device/device-action-card.tsx';
import { ScheduleAskCard } from './schedule-ask-card.tsx';
import { SubscriptionAskCard } from './subscription-ask-card.tsx';
import { TaskCardPreview } from './task-card-preview.tsx';
import { OutboundAskCard } from './outbound-ask-card.tsx';
import type { AskWork } from './asks-store.ts';
import { AskSource, useAnswerAsk } from './ask-context.tsx';
import './line-ask-card.css';

const ARGS_MARK = '」的参数：';
const DENY_IDS: ReadonlySet<string> = new Set(['deny', 'no', 'later']);

export interface HardLineDetail {
  consequence: string | null;
  args: Record<string, unknown> | null;
  rest: string | null;
}

export function readDetail(ask: Pick<AskView, 'basis' | 'detail'>): HardLineDetail {
  if (ask.detail === null) {
    return { consequence: null, args: null, rest: null };
  }
  if (ask.basis !== 'hard_line') {
    return { consequence: null, args: null, rest: ask.detail };
  }
  const lines = ask.detail.split('\n');
  const argsLine = lines.find((line) => line.includes(ARGS_MARK));
  let args: Record<string, unknown> | null = null;
  if (argsLine !== undefined) {
    try {
      const parsed: unknown = JSON.parse(argsLine.slice(argsLine.indexOf(ARGS_MARK) + ARGS_MARK.length));
      args = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : null;
    } catch (cause) {
      console.warn('硬线卡的参数不是完整的 JSON（可能被截短了），按原文显示', cause);
    }
  }
  const consequence = lines[0]?.trim().replace(/。$/, '') ?? null;
  return { consequence: consequence === '' ? null : consequence, args,
    rest: args === null && argsLine !== undefined ? argsLine : null };
}

const HEAD_KEYS = ['to', 'recipient', 'subject', 'title'];
const BODY_KEYS = ['body', 'text', 'content', 'message'];

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function Preview({ args }: { args: Record<string, unknown> }): ReactNode {
  const to = str(args['to']) ?? str(args['recipient']);
  const subject = str(args['subject']) ?? str(args['title']);
  const body = BODY_KEYS.map((key) => str(args[key])).find((value) => value !== null) ?? null;
  const others = Object.entries(args).filter(([key]) => !HEAD_KEYS.includes(key) && !BODY_KEYS.includes(key));
  return (
    <div className="line-ask-preview">
      {to === null && subject === null ? null : (
        <div className="line-ask-preview-head">
          <Icon name="mail" size={14} />
          {to === null ? null : <span className="line-ask-to">{to}</span>}
          {subject === null ? null : <span className="line-ask-subject">{subject}</span>}
        </div>
      )}
      {body === null ? null : <p className="line-ask-body">{body}</p>}
      {others.length === 0 ? null : (
        <dl className="line-ask-fields">
          {others.map(([key, value]) => (
            <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

function WriteAnswer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }): ReactNode {
  const [text, setText] = useState('');
  return (
    <form className="line-ask-write" onSubmit={(event) => {
      event.preventDefault();
      if (text.trim() !== '') onSend(text.trim());
    }}>
      <textarea className="field-input" aria-label="写一句作答" placeholder="写一句作答" rows={2} value={text}
        disabled={busy} onChange={(event) => setText(event.target.value)} />
      <button type="submit" className="primary-button" disabled={busy || text.trim() === ''}>答复</button>
    </form>
  );
}

export function LineAskCard({ ask, thread }: { ask: AskView; thread?: string | null }): ReactNode {
  if (ask.outbound !== undefined) { return <OutboundAskCard ask={ask} card={ask.outbound} />; }
  if (ask.deviceAction === true || ask.requiresSignature === true) {
    return <DeviceActionCard ask={ask} />;
  }
  if (ask.scheduleCard !== undefined) {
    return <ScheduleAskCard ask={ask} card={ask.scheduleCard} />;
  }
  if (ask.subscriptionCard !== undefined) {
    return <SubscriptionAskCard ask={ask} card={ask.subscriptionCard} />;
  }
  return <PlainAskCard ask={ask} thread={thread ?? null} />;
}

function PlainAskCard({ ask, thread }: { ask: AskView; thread: string | null }): ReactNode {
  const live = useLive();
  const answerAsk = useAnswerAsk();
  const work: AskWork | undefined = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true;
  const detail = readDetail(ask);
  const deny = ask.options.find((option) => DENY_IDS.has(option.id));
  const choices = ask.options.filter((option) => option !== deny);
  const answer = (optionId: string): void => void answerAsk(ask, { optionId });
  const card = ask.taskCard;
  const label = card === undefined ? thread : `以你的名义发给${card.to.name}`;
  const question = card === undefined ? ask.question : `把这张任务卡发给${card.to.name}？`;
  return (
    <section className="line-ask content-card" data-kind={ask.kind} aria-label={`${ask.kindLabel}：${question}`}>
      <header className="content-card-head">
        <AskTag ask={ask} />
        <h3 className="content-card-title">{question}</h3>
      </header>
      {label === null || label === undefined ? <AskSource ask={ask} /> : <p className="line-ask-thread">{label}</p>}
      {card === undefined ? null : <TaskCardPreview card={card} />}
      {detail.args === null || card !== undefined ? null : <Preview args={detail.args} />}
      {detail.rest === null ? null : <p className="line-ask-detail">{detail.rest}</p>}
      {choices.length === 0 ? <WriteAnswer busy={busy} onSend={(text) => void answerAsk(ask, { text })} />
        : null}
      <div className="content-card-actions">
        {detail.consequence === null ? null : (
          <span className="content-card-note"><Icon name={card === undefined ? 'alert' : 'info'} size={14} />
            {detail.consequence}</span>
        )}
        <button type="button" className="text-button text-button-quiet" disabled={busy}
          onClick={() => (deny === undefined ? void live.asks.defer(ask) : answer(deny.id))}>
          {deny?.label ?? '先不'}
        </button>
        {[...choices].reverse().map((option) => (
          <button key={option.id} type="button" disabled={busy}
            className={option === choices[0] ? 'primary-button' : 'secondary-button'}
            aria-label={option.recommended ? `${option.label}（推荐）` : undefined}
            onClick={() => answer(option.id)}>{option.label}</button>
        ))}
      </div>
      {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
    </section>
  );
}
