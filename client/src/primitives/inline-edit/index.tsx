// 原语 6 · 就地编辑（component-recipes「就地编辑 InlineEdit」）：记忆三栏、约定、判断详情里直接改，带版本保护。
// 编辑态和阅读态同字号同行高；保存方式写明（点「保存」才提交）；状态：草稿（未保存）/ 提交中 / 失败（草稿保留）/
// 冲突（警示横幅由调用方给，不覆盖较新版本）。中文输入法选字时按回车不提交；多行框用 Ctrl / ⌘ + 回车提交，Esc 取消。
// 草稿存在哪由调用方定（state/edit-drafts），这里只画和转发。

import { useId, type KeyboardEvent, type ReactNode } from 'react';
import './styles.css';

export type InlineEditStatus = 'draft' | 'saving' | 'failed' | 'conflict';

export interface InlineEditField {
  name: string;
  label: string;
  value: string;
  multiline?: boolean;
  /** 只读的字段（原话的字）：照样显示，旁边写为什么不能改。 */
  readOnlyNote?: string;
  placeholder?: string;
  /** 几个里选一个（现实结果：发生了 / 没发生 / 作废）：画成分段控件。 */
  options?: readonly { value: string; label: string }[];
  /** 等宽数字（p、先验）。 */
  mono?: boolean;
}

export interface InlineEditProps {
  /** 整个编辑块的无障碍名字：「改这条解释」。 */
  label: string;
  fields: readonly InlineEditField[];
  status: InlineEditStatus;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** 冲突时的警示横幅。 */
  banner?: ReactNode;
  /** 状态行下面的东西（还没了结的保存、服务端的拒绝原因）。 */
  children?: ReactNode;
}

const STATUS_TEXT: Readonly<Record<InlineEditStatus, string>> = {
  draft: '未保存 · 点「保存」才提交',
  saving: '保存中…',
  failed: '没存上，草稿还在',
  conflict: '别处改过了，草稿还在',
};

function FieldInput(props: {
  field: InlineEditField;
  id: string;
  onChange: (name: string, value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>, multiline: boolean) => void;
}): ReactNode {
  const { field } = props;
  if (field.readOnlyNote !== undefined) {
    return (
      <div className="inline-edit-readonly" id={props.id}>
        <p className="inline-edit-readonly-text">{field.value}</p>
        <p className="inline-edit-note">{field.readOnlyNote}</p>
      </div>
    );
  }
  if (field.options !== undefined) {
    return (
      <div className="segmented" id={props.id} role="group" aria-label={field.label}>
        {field.options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="segmented-item"
            aria-pressed={field.value === option.value}
            onClick={() => props.onChange(field.name, option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  const shared = {
    id: props.id,
    className: field.mono === true ? 'inline-edit-input is-mono' : 'inline-edit-input',
    value: field.value,
    placeholder: field.placeholder,
  };
  if (field.multiline === true) {
    return (
      <textarea
        {...shared}
        rows={3}
        onChange={(event) => props.onChange(field.name, event.target.value)}
        onKeyDown={(event) => props.onKeyDown(event, true)}
      />
    );
  }
  return (
    <input
      {...shared}
      onChange={(event) => props.onChange(field.name, event.target.value)}
      onKeyDown={(event) => props.onKeyDown(event, false)}
    />
  );
}

export function InlineEdit(props: InlineEditProps): ReactNode {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, multiline: boolean): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onCancel();
      return;
    }
    const submits = multiline ? event.key === 'Enter' && (event.ctrlKey || event.metaKey) : event.key === 'Enter';
    if (submits && props.submitDisabled !== true && props.status !== 'saving') {
      event.preventDefault();
      props.onSubmit();
    }
  };
  const failed = props.status === 'failed';
  return (
    <div className="inline-edit" role="group" aria-label={props.label} data-status={props.status}>
      {props.banner}
      {props.fields.map((field, index) => (
        <div key={field.name} className="inline-edit-field">
          <label className="field-label" htmlFor={`${id}-${index}`}>
            {field.label}
          </label>
          <FieldInput field={field} id={`${id}-${index}`} onChange={props.onChange} onKeyDown={onKeyDown} />
        </div>
      ))}
      <div className="inline-edit-foot">
        <span className={failed ? 'inline-edit-status is-error' : 'inline-edit-status'} role="status">
          {STATUS_TEXT[props.status]}
        </span>
        <button
          type="button"
          className="primary-button"
          disabled={props.submitDisabled === true || props.status === 'saving'}
          onClick={props.onSubmit}
        >
          {props.submitLabel ?? '保存'}
        </button>
        <button type="button" className="text-button text-button-quiet" onClick={props.onCancel}>
          取消
        </button>
      </div>
      {props.children}
    </div>
  );
}
