import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HIT_REGION_ATTRIBUTE } from '../../shell/hit-regions.ts';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import './styles.css';

export const TOAST_MS = 5_000;
const LEAVE_MS = 180;

export interface ToastAction {
  label: string;
  icon?: IconName;
  run: () => void;
}

export interface ToastInput {
  text: string;
  action?: ToastAction;
  tone?: 'error';
  persist?: boolean;
}

interface ToastState extends ToastInput {
  serial: number;
}

export const toastStore = new Store<ToastState | null>(null);

export function showToast(input: ToastInput): void {
  toastStore.set((current) => ({ ...input, serial: (current?.serial ?? 0) + 1 }));
}

export function showResultToast(text: string, failed: boolean): void {
  showToast(failed ? { text, tone: 'error' } : { text });
}

export function dismissToast(): void {
  toastStore.set(null);
}

export function ToastHost(): ReactNode {
  const toast = useStore(toastStore);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(TOAST_MS);
  const serial = toast?.serial ?? 0;
  useEffect(() => {
    remaining.current = TOAST_MS;
    setLeaving(false);
    setHeld(false);
  }, [serial]);
  useEffect(() => {
    if (toast === null || toast.persist === true || held || leaving) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => setLeaving(true), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [toast, held, leaving]);
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => toastStore.set((current) => current?.serial === serial ? null : current),
      LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, serial]);
  const action = toast?.action;
  return (
    <div className="toast-slot" aria-live="polite">
      {toast === null ? null : (
        <div key={toast.serial} className="toast" role={toast.tone === 'error' ? 'alert' : 'status'}
          data-leaving={leaving || undefined} {...{ [HIT_REGION_ATTRIBUTE]: 'toast' }}
          onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)} onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false);
          }}>
          <span className="toast-text">{toast.text}</span>
          {action === undefined ? null : (
            <button type="button" className="toast-action" onClick={() => {
              dismissToast();
              action.run();
            }}>
              {action.icon === undefined ? null : <Icon name={action.icon} size={14} />}{action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
