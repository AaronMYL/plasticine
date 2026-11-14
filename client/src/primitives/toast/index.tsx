// 提示条（11-14 界面统一，Aaron 弹框定「提示条只留一种」）：浮在主区底部居中，一句话加最多一个动作（撤销、重试、打开），
// 5 秒后收；鼠标停在上面、焦点在里面时不走；同时只有一条，新的顶掉旧的。取代信息流顶上的深色小条、网页里的浮条。
// 读屏：平常念一遍（status），出错的立刻念（alert）。壳里只挂一个 ToastHost（主区里），别处只调 showToast。
// 盖在原生网页标签上时报成点击区（data-hit-region），点得到。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { HIT_REGION_ATTRIBUTE } from '../../shell/hit-regions.ts';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import './styles.css';

/** 停多久再收。 */
export const TOAST_MS = 5_000;
/** 收起的动画多长（和 --motion-base 一样）。 */
const LEAVE_MS = 180;

export interface ToastAction {
  label: string;
  icon?: IconName;
  run: () => void;
}

export interface ToastInput {
  text: string;
  /** 最多一个动作。 */
  action?: ToastAction;
  /** 没做成的那种：读屏立刻念。 */
  tone?: 'error';
  /** 还在做的那种（「正在保存…」）：不自己收，等下一条顶掉。 */
  persist?: boolean;
}

interface ToastState extends ToastInput {
  /** 同一句再来也重新计时。 */
  serial: number;
}

export const toastStore = new Store<ToastState | null>(null);

export function showToast(input: ToastInput): void {
  toastStore.set((current) => ({ ...input, serial: (current?.serial ?? 0) + 1 }));
}

/** 做完一件事说一句：没做成的读屏立刻念。 */
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
