// 第二栏收起 / 展开（11-08 他定「左侧侧栏第二级增加一个能够收起的功能」，参考图「≡‹」在标题行）：每个栏目的标题行
// 最右边一个收起按钮（ColumnHead 自己放；消息、网页的标题行不是 ColumnHead，各自放一个）。⌘\ 也能切。
// 收起后网页变成一条窄栏（web-strip.tsx，最上面是展开按钮），别的栏目整列让给主区，展开按钮在主区页头最左边。

import { createContext, useContext, type ReactNode } from 'react';
import { IconButton } from '../icon-button.tsx';

export interface ColumnToggle {
  collapsed: boolean;
  toggle: () => void;
}

export const ColumnToggleContext = createContext<ColumnToggle | null>(null);

/** 快捷键提示：Mac 上 ⌘\，别处 Ctrl+\。 */
export function toggleShortcut(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘\\' : 'Ctrl+\\';
}

export function ColumnCollapseButton(): ReactNode {
  const toggle = useContext(ColumnToggleContext);
  if (toggle === null) {
    return null;
  }
  return <IconButton icon="column-collapse" label="收起侧栏" title={`收起侧栏 ${toggleShortcut()}`}
    className="column-collapse" aria-expanded={!toggle.collapsed} onClick={toggle.toggle} />;
}

/** 收起后的展开按钮（主区页头最左边 / 窄栏最上面）。 */
export function ColumnExpandButton({ className, tipSide }: { className?: string; tipSide?: 'right' | 'bottom' })
  : ReactNode {
  const toggle = useContext(ColumnToggleContext);
  if (toggle === null) {
    return null;
  }
  return <IconButton icon="column-expand" label="展开侧栏" title={`展开侧栏 ${toggleShortcut()}`}
    className={className} aria-expanded={!toggle.collapsed} data-tip-side={tipSide} onClick={toggle.toggle} />;
}
