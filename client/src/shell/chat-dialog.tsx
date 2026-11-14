// 悬浮对话框（设计稿 2026-11-03，用户定）：原来右侧整高的对话栏改成浮在整个页面最上层的对话框。
// 缩小是右下角 48px 圆球（角标是「等你 n」）；展开是右下角约 420×640 的浮窗：按住顶栏拖动、拖左边 / 上边 / 左上角
// 调大小，位置和大小记在本机（shell-prefs.ts）。手机上展开是全屏。展开时从圆球的位置「长」成浮窗（clip-path 形变，
// 260ms），收起时反过来缩回圆球。
// 第13批（11-14 Aaron 看过设计稿，取代 11-12 的停靠）：电脑上展开的对话浮在页面右侧——上、下、右各留 8、整高，
// 细边框加阴影，拖左边调宽（宽度记在本机）；打开、收起都不动页面布局，点页面不收起，Esc 或收起按钮才收。手机全屏。
// 顶栏切换主线、队友或群组；每条对话保留各自的草稿和附件。「问这一页」仍跟随当前页面。
// 滚动位置、草稿、引用片在 state/ 里，收起再展开、切标签都不变。

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { clampChatFrame, type ChatFrame } from '../state/shell-prefs.ts';
import { Conversation } from '../views/conversation/conversation.tsx';
import { DockTargetSelector, useDockTarget } from '../views/mates/dock-target.tsx';
import { IconButton } from './icon-button.tsx';
import { EASE_OUT, MOTION, canAnimate, play, playThen } from './motion.ts';
import './chat-dialog.css';

/** 入口的大小和离右下角的距离（第13批设计稿：头像 52，占 56 的位置，距右、距底各 24）。 */
export const BALL_SIZE = 56;
export const BALL_INSET = 24;
const BALL_AVATAR = 52;
/** 键盘调大小、挪位置一步多少：方向 I 的 16px 间距。 */
const KEY_STEP = 16;

interface DragState {
  pointerId: number;
  x: number;
  start: ChatFrame;
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}


/** 圆球在对话框里的位置，算成 clip-path：从圆球那一点长成整个框。圆球不在框里（框被拖走了）就只淡入。 */
function ballClip(dialog: DOMRect): string | null {
  const ball = { left: window.innerWidth - BALL_INSET - BALL_SIZE, top: window.innerHeight - BALL_INSET - BALL_SIZE };
  const top = ball.top - dialog.top;
  const left = ball.left - dialog.left;
  const right = dialog.right - (ball.left + BALL_SIZE);
  const bottom = dialog.bottom - (ball.top + BALL_SIZE);
  if ([top, left, right, bottom].some((value) => value < 0)) {
    return null;
  }
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${BALL_SIZE / 2}px)`;
}

function morphKeyframes(element: HTMLElement): Keyframe[] {
  const clip = ballClip(element.getBoundingClientRect());
  return clip === null
    ? [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }]
    : [{ clipPath: clip, opacity: 0.6 }, { clipPath: 'inset(0px 0px 0px 0px round 12px)', opacity: 1 }];
}

export interface ChatDialogProps {
  /** 手机：全屏，没有调宽。 */
  fullscreen: boolean;
  frame: ChatFrame;
  onCollapse: () => void;
  onFrame: (frame: ChatFrame) => void;
}

export function ChatDialog(props: ChatDialogProps): ReactNode {
  const { fullscreen } = props;
  const [dragFrame, setDragFrame] = useState<ChatFrame | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const drag = useRef<DragState | null>(null);
  const frame = clampChatFrame(dragFrame ?? props.frame, viewport());

  // 展开：从圆球长出来；焦点进输入框（键盘用户直接能打字）。
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element !== null) {
      play(element, morphKeyframes(element), MOTION.slow, EASE_OUT);
    }
  }, []);
  useEffect(() => {
    dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  }, []);
  // 窗口变小时把框收回窗口里（只是显示上收，记住的位置等你再拖时才改）。
  const [, setResized] = useState(0);
  useEffect(() => {
    const onResize = (): void => setResized((count) => count + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const collapse = (): void => {
    const element = dialog.current;
    if (element === null || !canAnimate(element)) {
      props.onCollapse();
      return;
    }
    playThen(element, [...morphKeyframes(element)].reverse(), MOTION.base, props.onCollapse);
  };

  const begin = (event: PointerEvent<HTMLElement>): void => {
    if (fullscreen || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, start: frame };
  };
  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    setDragFrame(clampChatFrame({ ...current.start, width: current.start.width - (event.clientX - current.x) },
      viewport()));
  };
  const end = (): void => {
    if (drag.current === null) {
      return;
    }
    drag.current = null;
    if (dragFrame !== null) {
      props.onFrame(dragFrame);
    }
    setDragFrame(null);
  };
  const keyResize = (event: KeyboardEvent<HTMLElement>): void => {
    const change: Record<string, Partial<ChatFrame>> = {
      ArrowLeft: { width: frame.width + KEY_STEP }, ArrowRight: { width: frame.width - KEY_STEP },
    };
    const patch = change[event.key];
    if (patch !== undefined) {
      event.preventDefault();
      props.onFrame(clampChatFrame({ ...frame, ...patch }, viewport()));
    }
  };
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) {
      event.preventDefault();
      collapse();
      queueMicrotask(() => document.querySelector<HTMLButtonElement>('.chat-ball')?.focus());
    }
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };
  const style: CSSProperties = fullscreen ? {} : { width: frame.width };

  return (
    <aside ref={dialog} className="chat-dialog" data-fullscreen={fullscreen} data-dragging={dragFrame !== null}
      data-hit-region="chat-dialog"
      style={style} aria-label="对话框" onKeyDown={onKey}>
      {fullscreen ? null : (
        <div className="chat-grip chat-grip-w" role="separator" tabIndex={0} aria-orientation="vertical"
          aria-label="调整对话框宽度（左右方向键）" aria-valuetext={`${frame.width}`}
          onKeyDown={keyResize} onPointerDown={begin} {...handlers}><span aria-hidden="true" /></div>
      )}
      <header className="chat-head">
        <DockTargetSelector />
        <IconButton icon={fullscreen ? 'close' : 'collapse'} className="chat-collapse"
          label={fullscreen ? '关上对话' : '缩小对话框'} onClick={collapse} />
      </header>
      <Conversation container={fullscreen ? 'sheet' : 'column'} />
    </aside>
  );
}

/**
 * 收起时右下角的入口（第13批，11-14 Aaron 看过设计稿）：就是当前对话对象的头像——主线、队友或群组，外面不包圆，
 * 平时静止、干活时按状态动；有等你的事左上角一枚「等你 n」。
 */
export function ChatBall({ waiting, onExpand }: { waiting: number; onExpand: () => void }): ReactNode {
  const target = useDockTarget();
  const label = waiting > 0 ? `展开对话框：${target.name}，等你 ${waiting}` : `展开对话框：${target.name}`;
  const ball = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    play(ball.current, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
      MOTION.base);
  }, []);
  return (
    <button ref={ball} type="button" className="chat-ball" aria-label={label} title={label} onClick={onExpand}
      data-hit-region="chat-ball">
      {target.avatar(BALL_AVATAR)}
      {waiting > 0 ? <span className="chat-ball-badge" aria-hidden="true">等你 {waiting}</span> : null}
    </button>
  );
}
