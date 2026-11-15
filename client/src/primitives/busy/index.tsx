// 按钮做的事在跑（11-15 界面统一，设计稿「多选、加载、空、正在连接」②）：按钮里转一个小圈，字留着占位、看不见，
// 按钮宽度不变；读屏念「正在读」（或给的那句）。取代各处按钮里把字换成「正在读…」。

import type { ReactNode } from 'react';
import './styles.css';

export function Spinner({ label = '正在读' }: { label?: string | undefined }): ReactNode {
  return <span className="spinner" role="status" aria-label={label} />;
}

/** 按钮里的字：busy 时字看不见（宽度不变），正中转一个小圈。 */
export function BusyText({ busy, label, children }: { busy: boolean; label?: string; children: ReactNode }): ReactNode {
  return (
    <span className="busy-text" data-busy={busy}>
      <span className="busy-text-label" aria-hidden={busy || undefined}>{children}</span>
      {busy ? <Spinner label={label} /> : null}
    </span>
  );
}
