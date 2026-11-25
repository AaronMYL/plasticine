import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { errorText } from '../api/errors.ts';
import './rename-field.css';

export interface RenameFieldProps {
  value: string;
  label: string;
  className?: string;
  maxLength?: number;
  onSave: (title: string) => Promise<void>;
  onDone: () => void;
}

export function RenameField({ value, label, className, maxLength, onSave, onDone }: RenameFieldProps): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean): void => {
    if (settled.current || saving) return;
    const title = draft.trim();
    if (!save || title === '' || title === value) {
      settled.current = true;
      onDone();
      return;
    }
    setSaving(true);
    setError(null);
    onSave(title).then(() => {
      settled.current = true;
      onDone();
    }, (cause: unknown) => {
      setSaving(false);
      setError(errorText(cause));
      input.current?.focus();
    });
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  };
  return (
    <span className={`rename-field ${className ?? ''}`.trim()}>
      <input ref={input} className="rename-input" value={draft} aria-label={label} maxLength={maxLength}
        disabled={saving} aria-invalid={error === null ? undefined : true}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={keys} onBlur={() => finish(true)} />
      {error === null ? null : <span className="rename-error" role="alert">{error}</span>}
    </span>
  );
}
