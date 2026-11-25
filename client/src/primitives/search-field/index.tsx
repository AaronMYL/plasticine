import { useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../../shell/icons.tsx';
import './styles.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'className' | 'aria-label'>;

export interface SearchFieldProps extends InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
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
