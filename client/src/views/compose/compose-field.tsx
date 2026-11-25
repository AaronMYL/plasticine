import type { ReactNode } from 'react';
import './compose.css';

export interface ComposeFieldProps {
  children: ReactNode;
  inputClass: string;
  draft: string;
  ghost: string | null;
  phone: boolean;
  onAccept: () => void;
  scrollTop: number;
}

export function ComposeField({ children, inputClass, draft, ghost, phone, onAccept, scrollTop }: ComposeFieldProps)
  : ReactNode {
  return (
    <div className="compose-field">
      {children}
      {ghost === null ? null : (
        <div className={`${inputClass} compose-ghost-layer`} aria-hidden="true"
          ref={(element) => { if (element !== null) element.scrollTop = scrollTop; }}>
          <span className="compose-ghost-draft">{draft}</span>
          <span className="compose-ghost" onMouseDown={(event) => event.preventDefault()}
            onClick={onAccept}>{ghost}</span>
          {phone ? null : <span className="compose-ghost-key mono">Tab</span>}
        </div>
      )}
    </div>
  );
}
