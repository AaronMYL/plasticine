// 原语 2 · 要你定卡。卡中卡（透明底 + --line2 描边，圆角 12，padding 16）：左上小签 → 一句 → 选项（推荐项第一个、
// 实底主按钮、字带「（推荐）」；多于 3 个或带说明时一行一个）→「展开依据」（第一行是为什么问）→ 右下「问一句」「先不」。
// 没有选项的卡写一句作答。点了选项就发；答了的卡收成一行（AskLine）留在原位，不消失。
// 写的那一句不存在组件里：由调用方按卡 id 存（state/inline-drafts.ts），切页、换容器不丢；调用方按 ask.id 给 key。
// 这张卡上还有没了结的操作（待核实、没送到）时不让输入新内容：重试只会原样发上一次的请求。

import { useState, type ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import { ASK_BASIS_LABELS } from '../../api/shared.ts';
import { OpLines, type OpView } from '../task-row/op-line.tsx';
import { formatClock } from '../message/index.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import './styles.css';

/** 卡上能写一句的两处：作答（没有选项的卡）和问一句。 */
export type AskDraftSlot = 'answer' | 'ask';

export interface AskCardProps {
  ask: AskView;
  ops: readonly OpView[];
  drafts: Readonly<Record<AskDraftSlot, string>>;
  onDraft: (slot: AskDraftSlot, text: string) => void;
  onOption: (optionId: string, text?: string) => void;
  onText: (text: string) => void;
  onDefer: () => void;
  onAskAbout: (text: string) => void;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
  /** 「看任务」：卡挂着任务时去任务清单。 */
  onShowTask?: (() => void) | undefined;
  onShowJudgment?: (() => void) | undefined;
  /** 一句之后、选项之前的依据（自迭代卡的截图和检查结果）。 */
  evidence?: ReactNode;
  /** Individually unavailable choices; unrelated choices remain available. */
  disabledOptions?: readonly string[];
}

/** 要你授权 / 要你动手用强调色描边，要你定 / 要你确认用中性描边（第 49 条）。 */
// 2026-11-03《全量界面优化》：小签不写「要你确认 · 自迭代」，换成一个图标块；授权 / 动手是陶土橙描边，定 / 确认是中性描边。
// 原来的字在悬停和读屏里。
const ASK_ICON: Readonly<Record<AskView['kind'], IconName>> = {
  act: 'device', approve: 'lock', confirm: 'check', decide: 'sliders',
};

export function AskTag({ ask }: { ask: Pick<AskView, 'kind' | 'kindLabel'> }): ReactNode {
  const urgent = ask.kind === 'act' || ask.kind === 'approve';
  return <span className="ask-glyph" data-urgent={urgent} role="img" aria-label={ask.kindLabel} title={ask.kindLabel}>
    <Icon name={ASK_ICON[ask.kind]} size={13} />
  </span>;
}

/** 普通答卡和有专用签名动作的卡共用外框、标签与问题，不另造卡片原语。 */
export function AskCardFrame({ ask, children, label }: {
  ask: Pick<AskView, 'kind' | 'kindLabel' | 'question'> & { taskTitle?: string | null };
  children: ReactNode;
  label?: string;
}): ReactNode {
  return <section className="ask-card" data-kind={ask.kind} aria-label={label ?? `${ask.kindLabel}：${ask.question}`}>
    <header className="ask-card-head">
      <AskTag ask={ask} />
      {ask.taskTitle == null || ask.question.includes(ask.taskTitle) ? null
        : <span className="ask-card-task">{ask.taskTitle}</span>}
    </header>
    <p className="ask-question">{ask.question}</p>
    {children}
  </section>;
}

/** 答了的卡收成的一行；排在「等你」区里的卡也用这一行加「去处理」。 */
export function AskLine({ ask, action, showAnswer = true }: {
  ask: AskView; action?: ReactNode; showAnswer?: boolean;
}): ReactNode {
  return (
    <div className="ask-line" data-status={ask.status} aria-label={`${ask.kindLabel}：${ask.question}`}>
      <AskTag ask={ask} />
      <span className="ask-line-question">{ask.question}</span>
      {!showAnswer || ask.answer === null ? null : <span className="ask-line-answer">选择：{ask.answer.label}</span>}
      {action}
    </div>
  );
}

function Options(props: AskCardProps & { blocked: boolean }): ReactNode {
  const { ask, blocked } = props;
  if (ask.layout === 'list') {
    return (
      <div className="ask-options-list">
        {ask.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="ask-option-row"
            disabled={blocked || props.disabledOptions?.includes(option.id)
              || ask.collision === true && option.id === 'date' && props.drafts.answer === ''}
            onClick={() => props.onOption(option.id,
              ask.collision === true && option.id === 'date' ? props.drafts.answer : undefined)}
          >
            <span className="ask-option-label">{option.label}</span>
            {option.recommended ? <AiMark label="推荐" /> : null}
            {option.description === null ? null : <span className="ask-option-detail">{option.description}</span>}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="ask-options">
      {ask.options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.recommended ? 'primary-button' : 'chip-button ask-option'}
          disabled={blocked || props.disabledOptions?.includes(option.id)
            || ask.collision === true && option.id === 'date' && props.drafts.answer === ''}
          onClick={() => props.onOption(option.id,
              ask.collision === true && option.id === 'date' ? props.drafts.answer : undefined)}
          aria-label={option.recommended ? `${option.label}（推荐）` : undefined}
          title={option.recommended ? '推荐' : undefined}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 展开依据的第一行（第 5 批「做还是问」）：为什么问——推出来的 / 有几种可能 / 资料里没有 / 硬线，后面接这一张具体为什么现在问。
 * 硬线用陶土橙描边（和授权、动手同一种），其余中性。上线前的旧卡没有依据，照旧写「为什么现在问」。
 */
function Basis({ ask }: { ask: AskView }): ReactNode {
  if (ask.basis == null) {
    return ask.why ? <p>为什么现在问：{ask.why}</p> : null;
  }
  const tone = ask.basis === 'hard_line' ? 'tag-accent' : 'tag-outline-quiet';
  return <p className="ask-basis">
    <span className={`tag ${tone}`}>{ASK_BASIS_LABELS[ask.basis]}</span>{ask.why ?? ''}
  </p>;
}

interface WriteOneProps {
  label: string;
  placeholder: string;
  value: string;
  blocked: boolean;
  onChange: (text: string) => void;
  onSend: (text: string) => void;
}

function WriteOne(props: WriteOneProps): ReactNode {
  const empty = props.value.trim() === '';
  return (
    <form
      className="ask-write"
      onSubmit={(event) => {
        event.preventDefault();
        if (!empty && !props.blocked) {
          props.onSend(props.value.trim());
        }
      }}
    >
      <textarea
        className="ask-write-input"
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        rows={2}
        value={props.value}
        disabled={props.blocked}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <button type="submit" className="primary-button" disabled={empty || props.blocked}>
        {props.label}
      </button>
    </form>
  );
}

export function AskCard(props: AskCardProps): ReactNode {
  const { ask, drafts } = props;
  const [detailOpen, setDetailOpen] = useState(false);
  // 上次写到一半的「问一句」还在：回来时那个输入框照样开着。
  const [asking, setAsking] = useState(drafts.ask !== '');
  const open = props.ops.find((op) => op.status !== 'failed');
  const blocked = open !== undefined;
  return (
    <AskCardFrame ask={ask}>
      {ask.failure == null ? null : <p className="ask-detail is-error" role="alert">卡在哪：{ask.failure}</p>}
      {props.evidence}
      {ask.collision === true ? <label className="field">改期日期
        <input type="date" aria-label="改到哪天" className="field-input" disabled={blocked}
          value={drafts.answer} onChange={(event) => props.onDraft('answer', event.target.value)} />
      </label> : null}
      {ask.options.length > 0 ? (
        <Options {...props} blocked={blocked} />
      ) : (
        <WriteOne
          label="答复"
          placeholder="写一句作答"
          value={drafts.answer}
          blocked={blocked}
          onChange={(text) => props.onDraft('answer', text)}
          onSend={props.onText}
        />
      )}
      {detailOpen ? <div className="ask-detail">
        <Basis ask={ask} />
        {ask.detail === null ? null : <p>{ask.detail}</p>}
        {ask.channelReason ? <p>为什么用这个渠道：{ask.channelReason}</p> : null}
      </div> : null}
      {asking ? (
        <WriteOne
          label="问 Plasticine"
          placeholder="先问 Plasticine 一句（不算作答）"
          value={drafts.ask}
          blocked={blocked}
          onChange={(text) => props.onDraft('ask', text)}
          onSend={props.onAskAbout}
        />
      ) : null}
      {open === undefined ? null : (
        <p className="ask-blocked">上一次「{open.label}」还没核实：先在下面「再核实」或「重发」，有了结果再写新的。</p>
      )}
      <OpLines ops={props.ops} onRetry={props.onRetry} onDismiss={props.onDismiss} />
      <footer className="ask-card-foot">
        {ask.detail === null && !ask.why && !ask.channelReason && ask.basis == null ? null : (
          <button
            type="button"
            className="text-button"
            aria-expanded={detailOpen}
            onClick={() => setDetailOpen((value) => !value)}
          >
            {detailOpen ? '收起依据' : '展开依据'}
          </button>
        )}
        {props.onShowTask === undefined ? null : (
          <button type="button" className="text-button" onClick={props.onShowTask}>
            看任务
          </button>
        )}
        {props.onShowJudgment === undefined ? null : <button type="button" className="text-button"
          onClick={props.onShowJudgment}>打开预测，确认结果</button>}
        <span className="ask-card-foot-end">
          <button
            type="button"
            className="text-button text-button-quiet"
            aria-expanded={asking}
            onClick={() => setAsking((value) => !value)}
          >
            问一句
          </button>
          <button type="button" className="text-button text-button-quiet" disabled={blocked} onClick={props.onDefer}>
            先不
          </button>
        </span>
      </footer>
    </AskCardFrame>
  );
}
