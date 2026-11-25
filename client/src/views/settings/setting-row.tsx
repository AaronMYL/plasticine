import type { ReactNode } from 'react';
import { DropdownMenu } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import './setting-row.css';

export interface SettingRowProps {
  name: ReactNode;
  tip?: string | undefined;
  tipLabel?: string | undefined;
  sub?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  as?: 'div' | 'li';
  label?: string | undefined;
  className?: string | undefined;
}

export function SettingRow(props: SettingRowProps): ReactNode {
  const Tag = props.as ?? 'div';
  const tipLabel = props.tipLabel ?? (typeof props.name === 'string' ? `${props.name}的说明` : '说明');
  return (
    <Tag className={props.className === undefined ? 'set-row' : `set-row ${props.className}`} aria-label={props.label}>
      {props.lead == null ? null : <span className="set-row-lead">{props.lead}</span>}
      <span className="set-row-text">
        <span className="set-row-name">
          {props.name}
          {props.tip === undefined || props.tip === '' ? null : <InfoTip label={tipLabel} text={props.tip} />}
        </span>
        {props.sub == null || props.sub === '' ? null : <span className="set-row-sub">{props.sub}</span>}
      </span>
      {props.children == null ? null : <span className="set-row-control">{props.children}</span>}
    </Tag>
  );
}

export function SettingSwitch({ name, tip, sub, checked, disabled, onChange, label }: {
  name: string; tip?: string | undefined; sub?: ReactNode; checked: boolean; disabled?: boolean;
  onChange: (checked: boolean) => void; label?: string;
}): ReactNode {
  return (
    <SettingRow name={name} tip={tip} sub={sub}>
      <input type="checkbox" role="switch" aria-label={label ?? name} checked={checked} disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)} />
    </SettingRow>
  );
}

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

export function SelectButton<T extends string>({ label, value, options, onChange, disabled, text }: {
  label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void;
  disabled?: boolean | undefined;
  text?: string | undefined;
}): ReactNode {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu label={label} className="set-select" align="end" disabled={disabled === true}
      items={options.map((option) => ({ label: option.label, checked: option.value === value,
        onSelect: () => { if (option.value !== value) onChange(option.value); } }))}>
      <span>{text ?? current?.label ?? '—'}</span><Icon name="chevron-down" size={14} />
    </DropdownMenu>
  );
}

export function SettingSelect<T extends string>(props: {
  name: string; tip?: string | undefined; sub?: ReactNode; value: T; options: readonly SelectOption<T>[];
  onChange: (value: T) => void; disabled?: boolean | undefined; text?: string | undefined;
}): ReactNode {
  return (
    <SettingRow name={props.name} tip={props.tip} sub={props.sub}>
      <SelectButton label={props.name} value={props.value} options={props.options} onChange={props.onChange}
        disabled={props.disabled} text={props.text} />
    </SettingRow>
  );
}

export function ValueButton({ value, label, expanded, onClick }: {
  value: ReactNode; label: string; expanded?: boolean | undefined; onClick: () => void;
}): ReactNode {
  return (
    <button type="button" className="set-value" aria-label={label} aria-expanded={expanded} onClick={onClick}>
      <span>{value}</span><Icon name={expanded === true ? 'chevron-down' : 'chevron-right'} size={14} />
    </button>
  );
}

export function SettingField({ name, tip, htmlFor, children }: { name: string; tip?: string | undefined;
  htmlFor: string; children: ReactNode }): ReactNode {
  return (
    <div className="set-field">
      <span className="set-field-name">
        <label htmlFor={htmlFor}>{name}</label>
        {tip === undefined ? null : <InfoTip label={`${name}的说明`} text={tip} />}
      </span>
      {children}
    </div>
  );
}
