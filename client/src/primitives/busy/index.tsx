import type { ReactNode } from 'react';
import './styles.css';

export function Spinner({ label = '正在读' }: { label?: string | undefined }): ReactNode {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function BusyText({ busy, label, children }: { busy: boolean; label?: string; children: ReactNode }): ReactNode {
  return (
    <span className="busy-text" data-busy={busy}>
      <span className="busy-text-label" aria-hidden={busy || undefined}>{children}</span>
      {busy ? <Spinner label={label} /> : null}
    </span>
  );
}
