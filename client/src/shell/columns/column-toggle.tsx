import { createContext, useContext, type ReactNode } from 'react';
import { IconButton } from '../icon-button.tsx';

export interface ColumnToggle {
  collapsed: boolean;
  toggle: () => void;
  inTitlebar?: boolean;
}

export const ColumnToggleContext = createContext<ColumnToggle | null>(null);

export function toggleShortcut(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘\\' : 'Ctrl+\\';
}

export function ColumnCollapseButton(): ReactNode {
  const toggle = useContext(ColumnToggleContext);
  if (toggle === null || toggle.inTitlebar === true) {
    return null;
  }
  return <IconButton icon="column-collapse" label="收起侧栏" title={`收起侧栏 ${toggleShortcut()}`}
    className="column-collapse" aria-expanded={!toggle.collapsed} onClick={toggle.toggle} />;
}

export function ColumnExpandButton({ className, tipSide }: { className?: string; tipSide?: 'right' | 'bottom' })
  : ReactNode {
  const toggle = useContext(ColumnToggleContext);
  if (toggle === null || toggle.inTitlebar === true) {
    return null;
  }
  return <IconButton icon="column-expand" label="展开侧栏" title={`展开侧栏 ${toggleShortcut()}`}
    className={className} aria-expanded={!toggle.collapsed} data-tip-side={tipSide} onClick={toggle.toggle} />;
}
