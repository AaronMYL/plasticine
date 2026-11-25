import { useState, type ReactNode } from 'react';
import type { AskView } from '../../api/types.ts';
import { ASK_BASIS_LABELS } from '../../api/shared.ts';
import { OpLines, type OpView } from '../task-row/op-line.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { AiMark } from '../../shell/glyph.tsx';
import './styles.css';

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
  onShowTask?: (() => void) | undefined;
  onShowJudgment?: (() => void) | undefined;
  evidence?: ReactNode;
  /** Individually unavailable choices; unrelated choices remain available. */
  disabledOptions?: readonly string[];
}

const ASK_ICON: Readonly<Record<AskView['kind'], IconName>> = {
  act: 'device', approve: 'lock', confirm: 'check', decide: 'sliders',
};

export function AskTag({ ask }: { ask: Pick<AskView, 'kind' | 'kindLabel'> }): ReactNode {
  const urgent = ask.kind === 'act' || ask.kind === 'approve';
  return <span className="ask-glyph" data-urgent={urgent} role="img" aria-label={ask.kindLabel}
    data-tip={ask.kindLabel}>
    <Icon name={ASK_ICON[ask.kind]} size={14} />
  </span>;
}

export function AskCardFrame({ ask, children, label }: {
  ask: Pick<AskView, 'kind' | 'kindLabel' | 'question'> & { taskTitle?: string | null };
  children: ReactNode;
  label?: string;
}): ReactNode {
  return <section className="ask-card content-card" data-kind={ask.kind}
    aria-label={label ?? `${ask.kindLabel}：${ask.question}`}>
    <header className="content-card-head">
      <AskTag ask={ask} />
      <p className="ask-question content-card-title">{ask.question}</p>
    </header>
    {ask.taskTitle == null || ask.question.includes(ask.taskTitle) ? null
      : <p className="ask-card-task">{ask.taskTitle}</p>}
    {children}
  </section>;
}

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
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
