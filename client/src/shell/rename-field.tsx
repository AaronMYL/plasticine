// 原处改名（2026-11-08 设计稿 Library-Rename）：名字那一格换成输入框，字号行高不变；回车存、Esc 取消、点到别处也存。
// 没改或改成空的等于取消。中文输入法选字时的回车不算。存是调用方的事（onSave 返回 Promise，失败时框留着、写原因）。

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { errorText } from '../api/errors.ts';
import './rename-field.css';

export interface RenameFieldProps {
  value: string;
  /** 读屏名字：「「系统收尾逐项回执 5」的新名字」。 */
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
