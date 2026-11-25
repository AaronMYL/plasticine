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
import { CHAT_MIN_HEIGHT, clampChatFrame, type ChatFrame } from '../state/shell-prefs.ts';
import { Conversation } from '../views/conversation/conversation.tsx';
import { DockTargetSelector, useDockTarget } from '../views/mates/dock-target.tsx';
import { IconButton } from './icon-button.tsx';
import { WaitMark } from './wait-mark.tsx';
import { EASE_OUT, MOTION, canAnimate, play, playThen } from './motion.ts';
import './chat-dialog.css';

export const BALL_SIZE = 56;
export const BALL_INSET = 24;
const BALL_AVATAR = 52;
const KEY_STEP = 16;

type GripKind = 'w' | 'n' | 'nw';

interface DragState {
  pointerId: number;
  kind: GripKind;
  x: number;
  y: number;
  start: ChatFrame;
}

const FULL_TOP_TITLED = 52;
const FULL_TOP = 8;
const FULL_BOTTOM = 8;

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

function fullHeight(element: HTMLElement | null): number {
  const titled = (element?.closest('.shell') ?? document.querySelector('.shell'))?.hasAttribute('data-titled') === true;
  return window.innerHeight - (titled ? FULL_TOP_TITLED : FULL_TOP) - FULL_BOTTOM;
}

function withHeight(frame: ChatFrame, height: number, max: number): ChatFrame {
  const clamped = Math.round(Math.min(max, Math.max(CHAT_MIN_HEIGHT, height)));
  return clamped >= max ? { ...frame, full: true } : { ...frame, height: clamped, full: false };
}

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

export const DOCK_ROOM = '--dock-room';
const DOCK_GAP = 8;

export interface ChatDialogProps {
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
  useLayoutEffect(() => {
    if (fullscreen) return undefined;
    const root = document.documentElement;
    root.style.setProperty(DOCK_ROOM, `${frame.width + DOCK_GAP}px`);
    return () => { root.style.removeProperty(DOCK_ROOM); };
  }, [fullscreen, frame.width]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element !== null) {
      play(element, morphKeyframes(element), MOTION.slow, EASE_OUT);
    }
  }, []);
  useEffect(() => {
    dialog.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  }, []);
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

  const shownHeight = (): number => {
    const max = fullHeight(dialog.current);
    if (!frame.full) return Math.min(frame.height, max);
    const measured = dialog.current?.getBoundingClientRect().height ?? 0;
    return measured > 0 ? measured : max;
  };
  const begin = (kind: GripKind) => (event: PointerEvent<HTMLElement>): void => {
    if (fullscreen || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, kind, x: event.clientX, y: event.clientY,
      start: { ...frame, height: shownHeight() } };
  };
  const move = (event: PointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const { start, kind } = current;
    let next = kind === 'n' ? start : { ...start, width: start.width - (event.clientX - current.x) };
    if (kind !== 'w') {
      next = withHeight(next, start.height - (event.clientY - current.y), fullHeight(dialog.current));
    } else if (start.full) {
      next = { ...next, full: true };
    }
    setDragFrame(clampChatFrame(next, viewport()));
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
  const keyHeight = (event: KeyboardEvent<HTMLElement>): void => {
    const step = { ArrowUp: KEY_STEP, ArrowDown: -KEY_STEP }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      props.onFrame(clampChatFrame(withHeight(frame, shownHeight() + step, fullHeight(dialog.current)), viewport()));
    }
  };
  const restoreFull = (): void => props.onFrame({ ...frame, full: true });
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing && !event.defaultPrevented) {
      event.preventDefault();
      collapse();
      queueMicrotask(() => document.querySelector<HTMLButtonElement>('.chat-ball')?.focus());
    }
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };
  const shown = fullscreen ? null : frame.full ? null : Math.min(frame.height, fullHeight(dialog.current));
  const style: CSSProperties = fullscreen ? {} : shown === null ? { width: frame.width }
    : { width: frame.width, height: shown, top: 'auto' };

  return (
    <aside ref={dialog} className="chat-dialog" data-fullscreen={fullscreen} data-dragging={dragFrame !== null}
      data-hit-region="chat-dialog"
      style={style} aria-label="对话框" onKeyDown={onKey}>
      {fullscreen ? null : <>
        <div className="chat-grip chat-grip-w" role="separator" tabIndex={0} aria-orientation="vertical"
          aria-label="调整对话框宽度（左右方向键）" aria-valuetext={`${frame.width}`}
          onKeyDown={keyResize} onPointerDown={begin('w')} {...handlers}><span aria-hidden="true" /></div>
        <div className="chat-grip chat-grip-n" role="separator" tabIndex={0} aria-orientation="horizontal"
          aria-label="调整对话框高度（上下方向键）" aria-valuetext={frame.full ? '整高' : `${frame.height}`}
          onKeyDown={keyHeight} onDoubleClick={restoreFull} onPointerDown={begin('n')} {...handlers}>
          <span aria-hidden="true" /></div>
        <div className="chat-grip chat-grip-nw" role="separator" aria-label="调整对话框大小"
          onPointerDown={begin('nw')} {...handlers} />
      </>}
      <header className="chat-head">
        <DockTargetSelector />
        <IconButton icon={fullscreen ? 'close' : 'collapse'} className="chat-collapse"
          label={fullscreen ? '关上对话' : '缩小对话框'} onClick={collapse} />
      </header>
      <Conversation container={fullscreen ? 'sheet' : 'column'} />
    </aside>
  );
}

export function ChatBall({ waiting, onExpand }: { waiting: number; onExpand: () => void }): ReactNode {
  const target = useDockTarget();
  const label = waiting > 0 ? `展开对话框：${target.name}，等你 ${waiting}` : `展开对话框：${target.name}`;
  const ball = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    play(ball.current, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
      MOTION.base);
  }, []);
  return (
    <button ref={ball} type="button" className="chat-ball" aria-label={label} onClick={onExpand}
      data-hit-region="chat-ball">
      {target.avatar(BALL_AVATAR)}
      {waiting > 0 ? <span className="chat-ball-badge" aria-hidden="true"><WaitMark count={waiting} /></span> : null}
    </button>
  );
}
