// 搜索框（11-14 界面统一设计稿「搜索框：一种」）：高 36，触屏 44；左边放大镜，有字时右边出 ×，Esc 清空。
// 有字时 Esc 只清空、不往外传；空着再按 Esc 照常交给外面（关浮层、退出查找）。第二栏顶上、弹层里、设置里都用它。

import { useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../../shell/icons.tsx';
import './styles.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'className' | 'aria-label'>;

export interface SearchFieldProps extends InputProps {
  /** 读屏名字；不另给 placeholder 时也是框里的提示字。 */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** 外面那一层的类名（排版用：撑满、和别的控件并排）。 */
  className?: string | undefined;
  inputRef?: Ref<HTMLInputElement> | undefined;
}

export function SearchField({ label, value, onChange, className, inputRef, placeholder, onKeyDown, ...rest }
  : SearchFieldProps): ReactNode {
  const own = useRef<HTMLInputElement | null>(null);
  const attach = (element: HTMLInputElement | null): void => {
    own.current = element;
    if (typeof inputRef === 'function') inputRef(element);
    else if (inputRef != null) inputRef.current = element;
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== 'Escape' || value === '') return;
    event.preventDefault();
    event.stopPropagation();
    onChange('');
  };
  return (
    <div className={className === undefined ? 'search-field' : `search-field ${className}`}>
      <Icon name="search" size={16} />
      <input {...rest} ref={attach} type="search" className="search-field-input" aria-label={label}
        placeholder={placeholder ?? label} value={value} onChange={(event) => onChange(event.target.value)}
        onKeyDown={keyDown} />
      {value === '' ? null : (
        <button type="button" className="search-field-clear" aria-label="清空" onClick={() => {
          onChange('');
          own.current?.focus();
        }}><Icon name="close" size={12} /></button>
      )}
    </div>
  );
}
