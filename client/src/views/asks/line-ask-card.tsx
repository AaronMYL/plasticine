// 线出的要你定卡（原语 2，2026-11-05 设计稿 Waiting）：图标块 + 哪条线 → 一句 → 要做的那件事的样子（硬线卡：要发出去的
// 东西）→ 主按钮 · 次按钮 · 后果（常显，做了收不回的必须写）→ 行尾「先不」。没有选项的卡写一句作答。
// 硬线卡的详情是服务端拼的三行（hard-line.ts）：后果、硬线说明、「工具」的参数 JSON；这里拆开，后果放按钮旁，
// 参数照样子画（收件人 · 标题 · 正文；认不出的字段一行一个）。

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
import type { AskWork } from './asks-store.ts';
import './line-ask-card.css';

const ARGS_MARK = '」的参数：';
const DENY_IDS: ReadonlySet<string> = new Set(['deny', 'no', 'later']);

export interface HardLineDetail {
  consequence: string | null;
  args: Record<string, unknown> | null;
  rest: string | null;
}

/** 拆详情：硬线卡第一行是后果，带「」的参数：」的那一行是参数 JSON；别的卡整段是依据。 */
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

/** 要做的那件事的样子：收件人 · 标题一行，正文照原样换行；别的字段一行一个。 */
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
  // 设备动作保留逐次确认卡，确认身份由本人会话给出。
  if (ask.deviceAction === true || ask.requiresSignature === true) {
    return <DeviceActionCard ask={ask} />;
  }
  // 起草好的定时卡（《优化清单》第 3 条）：照稿子画成定时卡。
  if (ask.scheduleCard !== undefined) {
    return <ScheduleAskCard ask={ask} card={ask.scheduleCard} />;
  }
  // 研究周报样刊附的「开启定时 / 再改改」（第 7 批第 14 条）。
  if (ask.subscriptionCard !== undefined) {
    return <SubscriptionAskCard ask={ask} card={ask.subscriptionCard} />;
  }
  return <PlainAskCard ask={ask} thread={thread ?? null} />;
}

function PlainAskCard({ ask, thread }: { ask: AskView; thread: string | null }): ReactNode {
  const live = useLive();
  const work: AskWork | undefined = useStore(live.asks.store).work.get(ask.id);
  const busy = work?.busy === true;
  const detail = readDetail(ask);
  const deny = ask.options.find((option) => DENY_IDS.has(option.id));
  const choices = ask.options.filter((option) => option !== deny);
  const answer = (optionId: string): void => void live.asks.answer(ask, { optionId });
  // Plasticine 起草的任务卡（2026-11-05 设计稿 Task-Draft）：以你的名义发出去，卡上画成任务卡的样子。
  const card = ask.taskCard;
  const label = card === undefined ? thread : `以你的名义发给${card.to.name}`;
  const question = card === undefined ? ask.question : `把这张任务卡发给${card.to.name}？`;
  return (
    <section className="line-ask" data-kind={ask.kind} aria-label={`${ask.kindLabel}：${question}`}>
      <header className="line-ask-head">
        <AskTag ask={ask} />
        {label === null || label === undefined ? null : <span className="line-ask-thread">{label}</span>}
      </header>
      <h3 className="line-ask-question">{question}</h3>
      {card === undefined ? null : <TaskCardPreview card={card} />}
      {detail.args === null || card !== undefined ? null : <Preview args={detail.args} />}
      {detail.rest === null ? null : <p className="line-ask-detail">{detail.rest}</p>}
      {choices.length === 0 ? <WriteAnswer busy={busy} onSend={(text) => void live.asks.answer(ask, { text })} />
        : null}
      <div className="line-ask-actions">
        {choices.map((option, index) => (
          <button key={option.id} type="button" disabled={busy}
            className={index === 0 ? 'primary-button' : 'secondary-button'}
            aria-label={option.recommended ? `${option.label}（推荐）` : undefined}
            onClick={() => answer(option.id)}>{option.label}</button>
        ))}
        {detail.consequence === null ? null : (
          <span className="line-ask-consequence"><Icon name={card === undefined ? 'alert' : 'info'} size={13} />
            {detail.consequence}</span>
        )}
        <span className="line-ask-spacer" />
        <button type="button" className="text-button text-button-quiet" disabled={busy}
          onClick={() => (deny === undefined ? void live.asks.defer(ask) : answer(deny.id))}>
          {deny?.label ?? '先不'}
        </button>
      </div>
      {work?.error == null ? null : <p className="line-ask-error" role="alert">{work.error}</p>}
    </section>
  );
}
