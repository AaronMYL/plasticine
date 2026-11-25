import type { ReactNode } from 'react';

export function WaitMark({ count, hidden = false }: { count?: number; hidden?: boolean }): ReactNode {
  return (
    <span className="wait-mark" aria-hidden={hidden ? 'true' : undefined}>
      <span className="dot dot-accent" aria-hidden="true" />
      {count === undefined ? '等你' : `等你 ${count}`}
    </span>
  );
}
