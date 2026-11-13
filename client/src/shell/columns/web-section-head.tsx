// 网页栏里一节的小标题（11-13 浏览器一套样子）：书签、分组、今天都是这一种——名字、个数，点了收起 / 展开。

import type { ReactNode } from 'react';
import { Icon } from '../icons.tsx';

export interface WebSectionHeadProps {
  id: string;
  title: string;
  count: number;
  collapsed: boolean;
  /** 收起 / 展开的那一块的 id。 */
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
