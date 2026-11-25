import { useEffect, useRef, type ReactNode } from 'react';
import './bulk.css';

export function PickAll({ total, picked, onAll, disabled = false, children }: { total: number; picked: number;
  onAll: (on: boolean) => void; disabled?: boolean; children?: ReactNode }): ReactNode {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current !== null) box.current.indeterminate = picked > 0 && picked < total;
  }, [picked, total]);
  return (
    <div className="bulk-header pick-head">
      <label className="bulk-all">
        <input ref={box} type="checkbox" className="bulk-check" checked={total > 0 && picked === total}
          disabled={disabled || total === 0} onChange={() => onAll(picked !== total)} />全选
      </label>
      <span className="text-meta">已选 {picked}</span>
      {children}
    </div>
  );
}

export function PickBar({ picked, children }: { picked: number; children: ReactNode }): ReactNode {
  return (
    <div className="bulk-bar pick-bar" role="group" aria-label="勾了的">
      <span className="text-meta">已选 {picked}</span>
      {children}
    </div>
  );
}
