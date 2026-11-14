// 设置页的一种行（11-14 Aaron 弹框选「按这一种行」，设计稿「设置页的布局」）：左边名字（14/22），补充说明收进 ⓘ，
// 必要的状态写在第二行（12/18）；右边只放控件——开关、下拉、按钮，或者「值 ›」进下一层。每行至少 48 高，行底一条细线。
// 模型提供商、设备、登录着的网站这些列表也是这一种行（lead 放图标，行尾 ⋯ 一直显示）。
// 要打字的框不走这一种行：SettingField 名字在上、框在下占满宽。

import type { ReactNode } from 'react';
import { DropdownMenu } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import './setting-row.css';

export interface SettingRowProps {
  name: ReactNode;
  /** ⓘ 里的补充说明；name 不是字时给 tipLabel。 */
  tip?: string | undefined;
  tipLabel?: string | undefined;
  /** 第二行：必要的状态（「这台设备收不到」「上次 11-14」）；不写说明。 */
  sub?: ReactNode;
  /** 名字左边的小图标、头像（列表行）。 */
  lead?: ReactNode;
  /** 右边的控件。 */
  children?: ReactNode;
  /** 列表里的一行是 li，读屏名字用 label。 */
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

/** 一行开关：名字在左、开关在右；开关的读屏名字就是这一行的名字。 */
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

/** 下拉：按钮上写现在选的，点开一列，选中的打勾（全站的下拉菜单，不用系统的 select）。 */
export function SelectButton<T extends string>({ label, value, options, onChange, disabled, text }: {
  label: string; value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void;
  disabled?: boolean | undefined;
  /** 按钮上写的，不给就是选中那一项的名字。 */
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

/** 一行下拉。 */
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

/** 「值 ›」：点了进下一层（展开一块、开浮层）。 */
export function ValueButton({ value, label, expanded, onClick }: {
  value: ReactNode; label: string; expanded?: boolean | undefined; onClick: () => void;
}): ReactNode {
  return (
    <button type="button" className="set-value" aria-label={label} aria-expanded={expanded} onClick={onClick}>
      <span>{value}</span><Icon name={expanded === true ? 'chevron-down' : 'chevron-right'} size={14} />
    </button>
  );
}

/** 要打字的：名字在上（13/20）、框在下占满宽；框的 id 给 htmlFor。 */
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
