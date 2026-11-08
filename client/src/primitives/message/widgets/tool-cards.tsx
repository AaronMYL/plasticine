// 工具卡（设计稿 2026-11-03，用户要求「工具不再单独一组，轻操作在对话里用互动控件完成」）：
// 说「午饭 30」回记账卡，「25 分钟专注」回计时卡，「明天 9 点提醒我…」回提醒卡，「下周三下午」回日历卡。
// 卡头 = 类别色小方块 + 工具名 + 右边「打开记账」（要看全貌就开成一个标签）；卡身是这一笔 / 这一段 / 这一条；
// 卡脚是确认（主按钮）· 改 · 不用。做了以后卡收成一行结果，留「撤销」。

import { useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  CalendarCard,
  FocusCard,
  MessageWidgetAnswer,
  MoneyCard,
  ReminderCard,
  ToolCard,
} from '../../../api/shared.ts';
import { useTimeZone } from '../../../live.tsx';
import { hueVar, HueTile, type HueName } from '../../../shell/hue.tsx';
import { Icon, type IconName } from '../../../shell/icons.tsx';
import { toolRoute, type ToolName } from '../../../shell/routes.ts';
import { TabsContext } from '../../../shell/tabs-context.ts';
import type { AnswerProps } from './form-widgets.tsx';
import { clockOf, dayAndTime, minuteOfDay, money } from './widget-time.ts';

// 2026-11-05 专注、自建日历和提醒删了：这几种旧卡照旧画出来（读得懂），点不开对应的工具页（name 为 null）。
const LOOK: Record<ToolCard['tool'], { label: string; name: ToolName | null; hue: HueName; icon: IconName;
  confirm: string; done: string }> = {
  money: { label: '记账', name: '记账', hue: 'olive', icon: 'wallet', confirm: '记上', done: '已记上' },
  focus: { label: '专注', name: null, hue: 'sage', icon: 'timer', confirm: '开始', done: '在专注' },
  reminder: { label: '提醒', name: null, hue: 'ochre', icon: 'bell', confirm: '好', done: '已设好' },
  calendar: { label: '日历', name: null, hue: 'rose', icon: 'today', confirm: '加进日历', done: '已加进日历' },
};

/** 这张卡现在的状态：发出去还没回执的答案优先，没有就是消息里带的。 */
function stateOf(card: ToolCard, answer: MessageWidgetAnswer | null): ToolCard['state'] {
  if (answer?.kind !== 'decision') {
    return card.state;
  }
  if (answer.value === 'undo') {
    return 'draft';
  }
  return answer.value === 'confirm' ? 'done' : 'cancelled';
}

/** 卡上点「改」时放进输入框的那句话。 */
function editText(card: ToolCard): string {
  switch (card.tool) {
    case 'money': return `把「${card.note}」这笔改一下：`;
    case 'focus': return `专注「${card.label}」改成：`;
    case 'reminder': return `提醒「${card.text}」改成：`;
    case 'calendar': return `「${card.title}」换个时间：`;
  }
}

function OpenTool({ name }: { name: ToolName }): ReactNode {
  const tabs = useContext(TabsContext);
  if (tabs === null) {
    return null;
  }
  return (
    <button type="button" className="text-button text-button-quiet tool-card-open"
      onClick={() => tabs.openTab(toolRoute(name))}>
      打开{name}<Icon name="chevron-right" size={12} />
    </button>
  );
}

function Frame({ card, state, children, footer }: { card: ToolCard; state: ToolCard['state']; children: ReactNode;
  footer: ReactNode }): ReactNode {
  const look = LOOK[card.tool];
  return (
    <section className="widget tool-card" data-tool={card.tool} data-state={state} aria-label={`${look.label}卡`}
      style={{ '--card-hue': hueVar(look.hue) } as CSSProperties}>
      <header className="tool-card-head">
        <HueTile hue={look.hue} icon={look.icon} size={24} />
        <span className="tool-card-kind">{look.label}</span>
        {state === 'done' ? <span className="tool-card-status"><Icon name="check" size={12} />{look.done}</span>
          : null}
        {state === 'cancelled' ? <span className="tool-card-status is-quiet">没有{look.confirm}</span> : null}
        {look.name === null ? null : <OpenTool name={look.name} />}
      </header>
      <div className="tool-card-body">{children}</div>
      {footer}
    </section>
  );
}

function Footer({ card, state, onAnswer, onReset, onEdit, edit }: AnswerProps & { card: ToolCard;
  state: ToolCard['state']; edit: string }): ReactNode {
  const look = LOOK[card.tool];
  if (state !== 'draft') {
    return (
      <footer className="tool-card-foot">
        <button type="button" className="text-button text-button-quiet" onClick={onReset}>
          {state === 'done' ? '撤销' : '重新来'}
        </button>
      </footer>
    );
  }
  return (
    <footer className="tool-card-foot">
      <button type="button" className="primary-button"
        onClick={() => onAnswer({ kind: 'decision', value: 'confirm' })}>{look.confirm}</button>
      {onEdit === undefined ? null
        : <button type="button" className="chip-button" onClick={() => onEdit(editText(card))}>{edit}</button>}
      <button type="button" className="text-button text-button-quiet tool-card-skip"
        onClick={() => onAnswer({ kind: 'decision', value: 'cancel' })}>不用</button>
    </footer>
  );
}

function MoneyBody({ card }: { card: MoneyCard }): ReactNode {
  const timeZone = useTimeZone();
  return (
    <>
      <p className="tool-card-figure text-mono">{money(card.amountCents, card.currency)}</p>
      <p className="tool-card-line">
        <span className="tag tag-neutral">{card.category}</span>
        <span>{card.note}</span>
        <span className="text-meta">{dayAndTime(card.occurredAt, new Date(), timeZone)}</span>
      </p>
      {card.monthCategoryCents === null ? null : (
        <p className="tool-card-meta text-meta">
          记上后本月{card.category} <span className="text-mono">{money(card.monthCategoryCents, card.currency)}</span>
        </p>
      )}
    </>
  );
}

const SECOND_MS = 1000;

/** 还剩几秒：开始了按开始时间算（切走再回来照样对），没开始就是整段。 */
function useRemaining(card: FocusCard, running: boolean): number {
  const total = card.minutes * 60;
  const startedAt = card.startedAt === null ? null : Date.parse(card.startedAt);
  const compute = (): number => (startedAt === null ? total
    : Math.max(0, total - Math.floor((Date.now() - startedAt) / SECOND_MS)));
  const [remaining, setRemaining] = useState(compute);
  useEffect(() => {
    if (!running || startedAt === null) {
      setRemaining(total);
      return undefined;
    }
    setRemaining(compute());
    const timer = window.setInterval(() => setRemaining(compute()), SECOND_MS);
    return () => window.clearInterval(timer);
    // compute 只依赖下面这几个值。
  }, [running, startedAt, total]);
  return remaining;
}

function FocusBody({ card, state }: { card: FocusCard; state: ToolCard['state'] }): ReactNode {
  // 点「开始」到回执回来之前消息里还没有开始时间：先从点的那一刻算；回执里有了就按服务端的开始时间算。
  const [clicked, setClicked] = useState<string | null>(null);
  useEffect(() => {
    if (state === 'done' && clicked === null) {
      setClicked(new Date().toISOString());
    } else if (state !== 'done' && clicked !== null) {
      setClicked(null);
    }
  }, [state, clicked]);
  const startedAt = state === 'done' ? card.startedAt ?? clicked : null;
  const running = state === 'done' && startedAt !== null;
  const remaining = useRemaining({ ...card, startedAt }, running);
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
  const seconds = (remaining % 60).toString().padStart(2, '0');
  const progress = 1 - remaining / (card.minutes * 60);
  return (
    <>
      <p className="tool-card-figure text-mono" aria-label={`还剩 ${minutes} 分 ${seconds} 秒`}>
        {minutes}:{seconds}
      </p>
      <div className="tool-card-progress" role="progressbar" aria-label="专注进度"
        aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="tool-card-line">
        <span>{card.label}</span>
        <span className="text-meta">今天已专注 <span className="text-mono">{card.todayMinutes}</span> 分钟</span>
      </p>
    </>
  );
}

function ReminderBody({ card }: { card: ReminderCard }): ReactNode {
  const timeZone = useTimeZone();
  return (
    <>
      <p className="tool-card-title">{card.text}</p>
      <p className="tool-card-line">
        <span className="tool-card-when">{dayAndTime(card.dueAt, new Date(), timeZone)}</span>
        {card.repeat === null ? null : <span className="tag tag-neutral">{card.repeat}</span>}
        <span className="text-meta">到点发{card.channel}</span>
      </p>
    </>
  );
}

/** 日历卡的时间条：那天前后几个小时，已有的安排灰色，新的一段用类别色，撞上的标「冲突」。 */
function DayStrip({ card }: { card: CalendarCard }): ReactNode {
  const timeZone = useTimeZone();
  const all = [...card.around, { title: card.title, startAt: card.startAt, endAt: card.endAt, conflict: false }];
  const start = Math.floor(Math.min(...all.map((item) => minuteOfDay(item.startAt, timeZone))) / 60) * 60;
  const end = Math.ceil(Math.max(...all.map((item) => minuteOfDay(item.endAt, timeZone))) / 60) * 60;
  const span = Math.max(60, end - start);
  const place = (from: string, to: string): CSSProperties => ({
    left: `${((minuteOfDay(from, timeZone) - start) / span) * 100}%`,
    width: `${((minuteOfDay(to, timeZone) - minuteOfDay(from, timeZone)) / span) * 100}%`,
  });
  const hours = Array.from({ length: span / 60 + 1 }, (_, index) => start / 60 + index);
  return (
    <div className="day-strip" aria-hidden="true">
      <div className="day-strip-track">
        {card.around.map((item) => (
          <span key={`${item.startAt}:${item.title}`} className="day-strip-block"
            data-conflict={item.conflict} style={place(item.startAt, item.endAt)}>{item.title}</span>
        ))}
        <span className="day-strip-block is-new" style={place(card.startAt, card.endAt)}>{card.title}</span>
      </div>
      <div className="day-strip-hours text-mono">
        {hours.map((hour) => <span key={hour}>{hour}</span>)}
      </div>
    </div>
  );
}

function CalendarBody({ card }: { card: CalendarCard }): ReactNode {
  const timeZone = useTimeZone();
  const conflicts = card.around.filter((item) => item.conflict);
  return (
    <>
      <p className="tool-card-title">{card.title}</p>
      <p className="tool-card-line">
        <span className="tool-card-when">
          {dayAndTime(card.startAt, new Date(), timeZone)}–{clockOf(card.endAt, timeZone)}
        </span>
        {card.location === null ? null : <span className="text-meta">{card.location}</span>}
      </p>
      <DayStrip card={card} />
      {conflicts.length === 0 ? null : (
        <p className="tool-card-conflict">
          <span className="dot dot-accent" aria-hidden="true" />
          和「{conflicts.map((item) => item.title).join('」「')}」撞了半小时
        </p>
      )}
    </>
  );
}

const EDIT_LABEL: Record<ToolCard['tool'], string> = {
  money: '改', focus: '改时长', reminder: '改时间', calendar: '换个时间',
};

export function ToolCardView({ card, answer, onAnswer, onReset, onEdit }: AnswerProps & { card: ToolCard }): ReactNode {
  const state = stateOf(card, answer);
  const body = (() => {
    switch (card.tool) {
      case 'money': return <MoneyBody card={card} />;
      case 'focus': return <FocusBody card={card} state={state} />;
      case 'reminder': return <ReminderBody card={card} />;
      case 'calendar': return <CalendarBody card={card} />;
    }
  })();
  return (
    <Frame card={card} state={state} footer={<Footer card={card} state={state} answer={answer} onAnswer={onAnswer}
      onReset={onReset} edit={EDIT_LABEL[card.tool]} {...(onEdit === undefined ? {} : { onEdit })} />}>
      {body}
    </Frame>
  );
}
