import { useId, type KeyboardEvent, type ReactNode } from 'react';
import './styles.css';

export type InlineEditStatus = 'draft' | 'saving' | 'failed' | 'conflict';

export interface InlineEditField {
  name: string;
  label: string;
  value: string;
  multiline?: boolean;
  readOnlyNote?: string;
  placeholder?: string;
  options?: readonly { value: string; label: string }[];
  mono?: boolean;
}

export interface InlineEditProps {
  label: string;
  fields: readonly InlineEditField[];
  status: InlineEditStatus;
  onChange: (name: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  banner?: ReactNode;
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
