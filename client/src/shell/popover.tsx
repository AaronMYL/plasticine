// 小弹层（第 111 条：分组小签的右键菜单、标签右键菜单、加书签弹层、网页工具条的 ⋯）：浮起物，--layer-float 底加
// --lift，贴着点它的地方出现、不出视口。挂在 body 上并标 data-hit-region——Mac 原生网页垫在主网页下面时，落在弹层里的
// 点击交给主网页。什么时候关见 use-dismiss.ts（点外面、Esc、窗口失焦、切标签、缩放、锚点滚出视野）；打开时焦点进
// 第一个能点的东西，关掉后回到打开它的地方。菜单里方向键上下移。出现淡入下滑、收起淡出；减少动态效果时直接出现。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { HIT_REGION_ATTRIBUTE } from './hit-regions.ts';
import { Icon, type IconName } from './icons.tsx';
import { MOTION, play, playThen } from './motion.ts';
import { useDismiss, type DismissReason } from './use-dismiss.ts';
import './popover.css';

/** 弹层离视口边留这么多（间距档 8）。 */
const EDGE = 8;
/** 弹层和点它的东西之间空这么多。 */
const GAP = 4;

export interface PopoverAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function anchorOf(element: Element): PopoverAnchor {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/** 右键点的那一点。 */
export function pointAnchor(x: number, y: number): PopoverAnchor {
  return { left: x, top: y, right: x, bottom: y };
}

export interface PopoverProps {
  anchor: PopoverAnchor;
  /** 读屏名字。 */
  label: string;
  /** 菜单（一行一个动作）还是小表单（加书签）。 */
  role: 'menu' | 'dialog';
  /** 贴着左边还是右边对齐。 */
  align?: 'start' | 'end';
  className?: string;
  /**
   * 点开它的按钮：在它上面按下不算「点外面」（再点一下由按钮自己收起），滚动时浮层跟着它、它出了视野就收，
   * 关掉后焦点回到它。不给就按打开时焦点所在的地方。
   */
  trigger?: RefObject<HTMLElement | null>;
  /** 打开时焦点去哪：第一个能点的东西（键盘打开、小表单），还是浮层本身（鼠标打开的菜单，方向键接着能用）。 */
  initialFocus?: 'first' | 'panel';
  /** 正在收起：播完淡出再叫 onLeft 真拿掉；这期间不接点击、不再听关闭。 */
  leaving?: boolean;
  onLeft?: () => void;
  onClose: (reason: DismissReason) => void;
  children: ReactNode;
}

const FOCUSABLE = 'input, select, textarea, button:not(:disabled), [tabindex]:not([tabindex="-1"])';
const MENU_ITEMS = '[role^="menuitem"]:not(:disabled):not([aria-disabled="true"])';
const ENTER: Keyframe[] = [{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }];
const LEAVE: Keyframe[] = [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-2px)' }];

/** 菜单里的方向键：上下移一项（到头绕回）、Home / End 到首尾。 */
function moveInMenu(panel: HTMLElement, key: string): boolean {
  const items = [...panel.querySelectorAll<HTMLElement>(MENU_ITEMS)];
  if (items.length === 0) {
    return false;
  }
  const index = items.findIndex((item) => item === document.activeElement);
  const last = items.length - 1;
  const next = key === 'Home' ? 0 : key === 'End' ? last
    : key === 'ArrowDown' ? (index < 0 || index === last ? 0 : index + 1)
      : key === 'ArrowUp' ? (index <= 0 ? last : index - 1) : null;
  if (next === null) {
    return false;
  }
  items[next]?.focus();
  return true;
}

function placeOf(element: HTMLElement, anchor: PopoverAnchor, align: PopoverProps['align']):
  { left: number; top: number } {
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const preferred = align === 'end' ? anchor.right - width : anchor.left;
  const left = Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, preferred));
  const below = anchor.bottom + GAP;
  const top = below + height > window.innerHeight - EDGE ? Math.max(EDGE, anchor.top - GAP - height) : below;
  return { left, top };
}

export function Popover(props: PopoverProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  // 滚动时跟着按钮挪到的位置；父组件换了 anchor 就以新的为准。
  const [moved, setMoved] = useState<{ from: PopoverAnchor; to: PopoverAnchor } | null>(null);
  const anchor = moved !== null && moved.from === props.anchor ? moved.to : props.anchor;
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const shown = useRef(false);
  const leaving = props.leaving === true;
  // 收起途中又被打开（leaving 回到 false）：淡出播完也不拿掉。
  const leavingNow = useRef(leaving);
  leavingNow.current = leaving;
  const close = useRef(props.onClose);
  close.current = props.onClose;
  const left = useRef(props.onLeft);
  left.current = props.onLeft;
  // 因为什么关的：点外面、切到网页、切页这类，用户的注意力已经在别处，焦点不拉回按钮；Esc、选完一项才拉回。
  const dismissedBy = useRef<DismissReason | null>(null);
  const back = (): Element | null => {
    const reason = dismissedBy.current;
    return reason !== null && reason !== 'escape' ? null : props.trigger?.current ?? opener.current;
  };
  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) {
      return;
    }
    const next = placeOf(element, anchor, props.align);
    // 先直接摆到位、去掉 visibility: hidden：焦点在下面的 useEffect 里给，那时 React 还没按新状态重画，
    // 藏着的元素拿不到焦点。
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
    element.style.visibility = 'visible';
    setPlace(next);
    if (!shown.current) {
      shown.current = true;
      play(element, ENTER, MOTION.fast);
    }
  }, [anchor, props.align]);
  useDismiss({
    open: !leaving,
    inside: props.trigger === undefined ? [panel] : [panel, props.trigger],
    anchor: props.trigger,
    onAnchorMove: () => {
      const trigger = props.trigger?.current;
      if (trigger !== null && trigger !== undefined) {
        setMoved({ from: props.anchor, to: anchorOf(trigger) });
      }
    },
    onDismiss: (reason) => {
      dismissedBy.current = reason;
      close.current(reason);
    },
  });
  useEffect(() => {
    const element = panel.current;
    if (element === null) {
      return;
    }
    const first = element.querySelector<HTMLElement>(props.role === 'menu' ? MENU_ITEMS : FOCUSABLE);
    if (props.initialFocus === 'panel' || first === null) {
      element.focus({ preventScroll: true });
    } else {
      first.focus({ preventScroll: true });
    }
    return () => {
      // 焦点随弹层一起没了（落回 body）才送回打开它的地方；选了一项之后焦点已经去了别处（比如改名的输入框自己
      // 拿了焦点），不抢回来。
      const lost = document.activeElement === null || document.activeElement === document.body;
      const target = back();
      if (lost && target instanceof HTMLElement && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    };
  }, []);
  useEffect(() => {
    if (!leaving) {
      return;
    }
    const element = panel.current;
    const target = back();
    if (element?.contains(document.activeElement) === true && target instanceof HTMLElement && target.isConnected) {
      target.focus({ preventScroll: true });
    }
    playThen(element, LEAVE, MOTION.fast, () => {
      if (leavingNow.current) {
        left.current?.();
      }
    });
  }, [leaving]);
  const style = place === null
    ? { left: anchor.left, top: anchor.bottom + GAP, visibility: 'hidden' as const }
    : { left: place.left, top: place.top, visibility: 'visible' as const };
  return createPortal(
    <div ref={panel} className={`popover${props.className === undefined ? '' : ` ${props.className}`}`}
      role={props.role} aria-label={props.label} style={style} tabIndex={-1}
      data-leaving={leaving ? 'true' : undefined} {...{ [HIT_REGION_ATTRIBUTE]: 'popover' }}
      onKeyDown={(event) => {
        if (props.role !== 'menu' || panel.current === null) {
          return;
        }
        if (event.key === 'Tab') {
          // 菜单不是一站 Tab 顺序：Tab 收起、焦点回到按钮。
          event.preventDefault();
          dismissedBy.current = 'escape';
          close.current('escape');
        } else if (moveInMenu(panel.current, event.key)) {
          event.preventDefault();
        }
      }}>
      {props.children}
    </div>,
    document.body,
  );
}

export interface MenuItemProps {
  /** 不给就只有字（网页工具条的 ⋯ 菜单，设计稿 Web-Menu）。 */
  icon?: IconName | undefined;
  label: string;
  onSelect: () => void;
  /** 有下一级（项目页 ›）。 */
  more?: boolean;
  disabled?: boolean | undefined;
  title?: string | undefined;
  /** 行尾的快捷键（⌘F），等宽字；不给（手机）就不写。 */
  shortcut?: string | undefined;
  /** 开关项（阅读模式）：开着时行尾一个勾。 */
  checked?: boolean | undefined;
  /** 只留入口、还不能用：看得见、点不动，为什么点不动常显在名字下面一行小字（11-04 重做悬停：不再整行浮框）。 */
  unavailable?: string;
  /** 删除这类收不回或要去「最近删除」找回的：字和图标用 --err。 */
  danger?: boolean | undefined;
}

export function MenuItem(props: MenuItemProps): ReactNode {
  const unavailable = props.unavailable !== undefined;
  return (
    <button type="button" role={props.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      className={props.danger === true ? 'popover-item is-danger' : 'popover-item'} disabled={props.disabled}
      title={props.title}
      aria-checked={props.checked} aria-disabled={unavailable ? true : undefined}
      aria-description={props.unavailable}
      onClick={unavailable ? undefined : props.onSelect}>
      {props.icon === undefined ? null : <Icon name={props.icon} size={15} />}
      {unavailable ? (
        <span className="popover-item-text">
          <span className="popover-item-label">{props.label}</span>
          <span className="popover-item-note" aria-hidden="true">{props.unavailable}</span>
        </span>
      ) : <span className="popover-item-label">{props.label}</span>}
      {props.shortcut === undefined ? null : <kbd className="popover-item-key">{props.shortcut}</kbd>}
      {props.checked === true ? <Icon name="check" size={14} /> : null}
      {props.more === true ? <Icon name="chevron-right" size={14} /> : null}
    </button>
  );
}

export function MenuSeparator(): ReactNode {
  return <hr className="popover-separator" />;
}
