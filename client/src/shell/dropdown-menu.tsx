// 「点开选一项」的下拉菜单（2026-11-05 第 3 条）：触发按钮 + Popover role="menu"，全站这类菜单都用它，不再拿
// <details> 当菜单（点外面不收、菜单项还带 text-button 的下划线）。
// 关闭：见 use-dismiss.ts（点外面、Esc、窗口失焦、切标签、缩放、按钮滚出视野），选完一项也收；Esc 和选完后焦点回到
// 触发按钮（选的那一项自己把焦点交给了别处——比如格式菜单回到正文——就不抢）。
// 键盘：按钮上 ↓ / Enter / 空格打开并落在第一项，菜单里 ↑ ↓ Home End 移动、Enter 选、Tab 收起回到按钮。
// 鼠标打开时焦点落在菜单本身（不高亮第一项），方向键照样能用。出现 / 收起都是 --motion-fast 的淡入淡出。

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from './popover.tsx';
import type { IconName } from './icons.tsx';

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** 行尾的快捷键（⌘B）。 */
  shortcut?: string | undefined;
  /** 开关项：开着时行尾一个勾。 */
  checked?: boolean;
  /** 删除这类不可逆的：危险色。 */
  danger?: boolean;
  /** 多选的开关项：点了不收起菜单，接着点下一项。 */
  keepOpen?: boolean;
}

/** 菜单里的一条分隔线。 */
export const SEPARATOR = 'separator';
export type DropdownEntry = DropdownItem | typeof SEPARATOR;

export interface DropdownMenuProps {
  /** 触发按钮和菜单的读屏名字。 */
  label: string;
  /** 按钮里画什么（图标、字、▾）。 */
  children: ReactNode;
  items: readonly DropdownEntry[];
  className?: string;
  /** 菜单贴着按钮左边还是右边。 */
  align?: 'start' | 'end';
  disabled?: boolean;
  /** 悬停提示（只有图标的按钮）；按钮里有字时不用给。 */
  tip?: string;
  /** 按下按钮不抢焦点：选段工具条里点「⋯」时保住编辑器里的选区。 */
  keepFocus?: boolean;
  /** 是一行的「⋯」：右键这一行时在鼠标处打开它（context-menu.tsx）。 */
  rowMenu?: boolean;
}

type Phase = { kind: 'closed' } | { kind: 'open' | 'leaving'; anchor: PopoverAnchor; keyboard: boolean };

export function DropdownMenu(props: DropdownMenuProps): ReactNode {
  const button = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const open = phase.kind === 'open';
  const show = (keyboard: boolean): void => {
    if (button.current !== null) {
      setPhase({ kind: 'open', anchor: anchorOf(button.current), keyboard });
    }
  };
  const hide = (): void => {
    setPhase((current) => (current.kind === 'open' ? { ...current, kind: 'leaving' } : current));
  };
  const keyOnButton = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      show(true);
    }
  };
  return (
    <>
      <button ref={button} type="button" className={`dropdown-trigger ${props.className ?? ''}`.trim()}
        aria-label={props.label} aria-haspopup="menu" aria-expanded={open} disabled={props.disabled}
        data-open={open ? 'true' : undefined} data-tip={props.tip}
        data-row-menu={props.rowMenu === true ? '' : undefined}
        onMouseDown={props.keepFocus === true ? (event) => event.preventDefault() : undefined}
        onKeyDown={keyOnButton}
        onClick={(event) => {
          if (open) {
            hide();
          } else {
            // detail 为 0：键盘（Enter / 空格）按出来的点击。
            show(event.detail === 0);
          }
        }}>
        {props.children}
      </button>
      {phase.kind === 'closed' ? null : (
        <Popover anchor={phase.anchor} label={props.label} role="menu" align={props.align ?? 'start'}
          className="dropdown-menu" trigger={button} initialFocus={phase.keyboard ? 'first' : 'panel'}
          leaving={phase.kind === 'leaving'} onLeft={() => setPhase({ kind: 'closed' })} onClose={hide}>
          {props.items.map((item, index) => item === SEPARATOR ? <MenuSeparator key={`separator-${index}`} /> : (
            <MenuItem key={item.label} label={item.label} icon={item.icon} disabled={item.disabled === true}
              shortcut={item.shortcut} checked={item.checked} danger={item.danger} onSelect={() => {
                item.onSelect();
                if (item.keepOpen !== true) hide();
              }} />
          ))}
        </Popover>
      )}
    </>
  );
}
