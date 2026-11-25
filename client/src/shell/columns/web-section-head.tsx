import type { ReactNode } from 'react';
import { Icon } from '../icons.tsx';

export interface WebSectionHeadProps {
  id: string;
  title: string;
  count: number;
  collapsed: boolean;
  controls: string;
  onToggle: () => void;
}

export function WebSectionHead({ id, title, count, collapsed, controls, onToggle }: WebSectionHeadProps): ReactNode {
  return (
    <button type="button" id={id} className="web-section-head" aria-expanded={!collapsed} aria-controls={controls}
      aria-label={title} onClick={onToggle}>
      <span>{title}</span>
      <span className="web-section-count" aria-hidden="true">{count}</span>
      <span className="web-section-chevron" aria-hidden="true"><Icon name="chevron-down" size={12} /></span>
    </button>
  );
}
