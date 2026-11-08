// 消息里要你答的三种部件：选项、输入框、确认。答了收成一行「选了：…」留在原位，旁边「改」可以重答；
// 推荐项放第一个、是主按钮，按钮字里带「（推荐）」（和要你定卡同一套写法）。

import { useState, type FormEvent, type ReactNode } from 'react';
import type { ChoiceWidget, ConfirmWidget, InputWidget, MessageWidgetAnswer } from '../../../api/shared.ts';
import { Icon } from '../../../shell/icons.tsx';

export interface AnswerProps {
  /** 已发出、回执还没到的答案（先按它显示）；没有是 null，按部件自己的状态显示。 */
  answer: MessageWidgetAnswer | null;
  onAnswer: (answer: MessageWidgetAnswer) => void;
  /** 选项、输入框：重新摆出来再答；工具卡：撤销。 */
  onReset: () => void;
  /** 工具卡的「改」：把一句「改一下…」放进输入框。 */
  onEdit?: (text: string) => void;
}

function Answered({ text, onReset }: { text: string; onReset?: (() => void) | undefined }): ReactNode {
  return (
    <p className="widget-answered">
      <Icon name="check" size={14} />
      <span className="widget-answered-text">{text}</span>
      {onReset === undefined ? null
        : <button type="button" className="text-button text-button-quiet" onClick={onReset}>改</button>}
    </p>
  );
}

/** 短选项（不多于 3 个、都没有说明）并排成按钮；否则一行一个。 */
function inline(widget: ChoiceWidget): boolean {
  return !widget.multiple && widget.options.length <= 3 && widget.options.every((option) => option.hint === undefined);
}

export function ChoiceWidgetView({ widget, answer, onAnswer, onReset }: AnswerProps & { widget: ChoiceWidget }) {
  const [picked, setPicked] = useState<string[]>([]);
  const chosen = answer?.kind === 'choice' ? answer.optionIds : widget.answer;
  if (chosen !== null) {
    const labels = widget.options.filter((option) => chosen.includes(option.id)).map((option) => option.label);
    return (
      <div className="widget widget-choice" data-state="answered">
        <p className="widget-prompt">{widget.prompt}</p>
        <Answered text={`选了：${labels.join('、')}`} onReset={onReset} />
      </div>
    );
  }
  const choose = (id: string): void => {
    if (!widget.multiple) {
      onAnswer({ kind: 'choice', optionIds: [id] });
      return;
    }
    setPicked((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  };
  const row = inline(widget);
  return (
    <div className="widget widget-choice" role="group" aria-label={widget.prompt}>
      <p className="widget-prompt">{widget.prompt}</p>
      <div className={row ? 'widget-options is-row' : 'widget-options'}>
        {widget.options.map((option) => {
          const selected = picked.includes(option.id);
          const primary = row && option.recommended === true;
          return (
            <button key={option.id} type="button" aria-pressed={widget.multiple ? selected : undefined}
              className={primary ? 'primary-button' : 'chip-button widget-option'}
              onClick={() => choose(option.id)}>
              {widget.multiple ? <span className="widget-check" aria-hidden="true">
                {selected ? <Icon name="check" size={12} /> : null}</span> : null}
              <span className="widget-option-label">{option.label}{row && option.recommended === true
                ? '（推荐）' : ''}</span>
              {!row && option.recommended === true ? <span className="tag tag-outline-quiet">推荐</span> : null}
              {option.hint === undefined ? null : <span className="widget-option-hint text-meta">{option.hint}</span>}
            </button>
          );
        })}
      </div>
      {widget.multiple ? (
        <div className="widget-actions">
          <button type="button" className="primary-button" disabled={picked.length === 0}
            onClick={() => onAnswer({ kind: 'choice', optionIds: picked })}>确定</button>
        </div>
      ) : null}
    </div>
  );
}

export function InputWidgetView({ widget, answer, onAnswer, onReset }: AnswerProps & { widget: InputWidget }) {
  const [draft, setDraft] = useState('');
  const text = answer?.kind === 'input' ? answer.text : widget.answer;
  if (text !== null) {
    return (
      <div className="widget widget-input" data-state="answered">
        <p className="widget-prompt">{widget.label}</p>
        <Answered text={text} onReset={onReset} />
      </div>
    );
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (draft.trim() !== '') {
      onAnswer({ kind: 'input', text: draft.trim() });
    }
  };
  return (
    <form className="widget widget-input" onSubmit={submit}>
      <label className="widget-prompt" htmlFor={`widget-${widget.id}`}>{widget.label}</label>
      <div className="widget-input-row">
        {widget.multiline ? (
          <textarea id={`widget-${widget.id}`} className="field-input" rows={3} placeholder={widget.placeholder}
            value={draft} onChange={(event) => setDraft(event.target.value)} />
        ) : (
          <input id={`widget-${widget.id}`} className="field-input" placeholder={widget.placeholder} value={draft}
            onChange={(event) => setDraft(event.target.value)} />
        )}
        <button type="submit" className="primary-button" disabled={draft.trim() === ''}>
          {widget.submitLabel}
        </button>
      </div>
    </form>
  );
}

/** 确认只答一次（答了 Plasticine 就接着做了），没有「改」。 */
export function ConfirmWidgetView({ widget, answer, onAnswer }: AnswerProps & { widget: ConfirmWidget }) {
  const state = answer?.kind === 'decision' ? (answer.value === 'confirm' ? 'confirmed' : 'cancelled') : widget.state;
  if (state !== 'open') {
    return (
      <div className="widget widget-confirm" data-state={state}>
        <p className="widget-prompt">{widget.text}</p>
        <Answered text={state === 'confirmed' ? `已点「${widget.confirmLabel}」` : `已点「${widget.cancelLabel}」`} />
      </div>
    );
  }
  return (
    <div className="widget widget-confirm">
      <p className="widget-prompt">{widget.text}</p>
      <div className="widget-actions">
        <button type="button" className="primary-button"
          onClick={() => onAnswer({ kind: 'decision', value: 'confirm' })}>{widget.confirmLabel}</button>
        <button type="button" className="chip-button"
          onClick={() => onAnswer({ kind: 'decision', value: 'cancel' })}>{widget.cancelLabel}</button>
      </div>
    </div>
  );
}
