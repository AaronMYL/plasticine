// 行尾 ⋯（2026-11-04 重做悬停）：一行的次要操作收进 ⋯，点了在 ⋯ 下面出菜单（popover.tsx 的 Popover role="menu" +
// MenuItem：关闭逻辑（use-dismiss.ts）、焦点进出、不出视口、Mac 原生网页垫在下面时的点击分区都现成）。
// 说明不再进 ⋯：必要的常显，补充的用 ⓘ（info-tip.tsx）。
// 一列里有的行有次要操作、有的没有：没有的那行留一个同宽、读屏看不见的占位，⋯ 列对齐，不时有时无地错位。

import { Fragment, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import type { IconName } from './icons.tsx';
import { anchorOf, MenuItem, MenuSeparator, Popover, type PopoverAnchor } from './popover.tsx';

export interface RevealAction {
  icon: IconName;
  label: string;
  /** anchor 是 ⋯ 的位置：要接着出下一层弹层（比如「移到」）时贴着它出。 */
  onSelect: (anchor: PopoverAnchor) => void;
  disabled?: boolean | undefined;
  title?: string | undefined;
  /** 删除：上面一道分隔线，字用 --err（设计稿 Library-Menu）。 */
  danger?: boolean | undefined;
}

export interface RevealMoreProps {
  /** ⋯ 和菜单的读屏名字，比如「「整理访谈稿」的更多操作」。 */
  label: string;
  /** 这一行的次要操作，按显示顺序；没有就只留占位。 */
  actions?: readonly RevealAction[];
}

export function RevealMore({ label, actions = [] }: RevealMoreProps): ReactNode {
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  if (actions.length === 0) {
    return <span className="reveal-more reveal-more-slot" aria-hidden="true" />;
  }
  const close = (): void => setMenu(null);
  // ⋯ 是菜单的触发按钮（Popover 的 trigger）：在它上面按下不算点外面，菜单开着时再点一下就是收起。
  const click = (): void => {
    if (menu !== null) {
      close();
    } else if (button.current !== null) {
      setMenu(anchorOf(button.current));
    }
  };
  return (
    <>
      <IconButton ref={button} icon="more" className="reveal-more" label={label} title="更多"
        aria-haspopup="menu" aria-expanded={menu !== null} onClick={click} />
      {menu === null ? null : (
        <Popover anchor={menu} label={label} role="menu" align="end" trigger={button} onClose={close}>
          {actions.map((action, index) => (
            <Fragment key={action.label}>
              {action.danger === true && index > 0 ? <MenuSeparator /> : null}
              <MenuItem icon={action.icon} label={action.label} disabled={action.disabled === true}
                danger={action.danger} {...(action.title === undefined ? {} : { title: action.title })}
                onSelect={() => {
                  close();
                  action.onSelect(menu);
                }} />
            </Fragment>
          ))}
        </Popover>
      )}
    </>
  );
}
