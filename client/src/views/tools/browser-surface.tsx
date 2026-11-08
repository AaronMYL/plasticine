// 画面是成果预览，透明文本框只承接原生输入法；输入不会进入 inlineDrafts 或其他持久化状态。
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { BrowserActionInput, BrowserFrame, BrowserViewDto } from '../../api/shared.ts';

const MOVE_INTERVAL_MS = 80;
const MAX_SCROLL_PX = 10_000;
const LONG_PRESS_MS = 500;
const TAP_TOLERANCE_PX = 8;
const WHEEL_LINE_PX = 16;
export function pagePoint(x: number, y: number,
  rect: { left: number; top: number; width: number; height: number }, frame: BrowserFrame): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(frame.width - 1, Math.round(x - rect.left))),
    y: Math.max(0, Math.min(frame.height - 1, Math.round(y - rect.top))),
  };
}

function modifiers(event: KeyboardEvent): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

export function BrowserSurface({ frame, onAction, onAck, onError, disabled = false, keyboardRef }: {
  frame: BrowserFrame | null;
  onAction(action: BrowserActionInput, done?: (view: BrowserViewDto) => void): void;
  onAck(sequence: number): void;
  onError(message: string): void;
  disabled?: boolean;
  keyboardRef?: RefObject<HTMLTextAreaElement | null>;
}): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const localKeyboard = useRef<HTMLTextAreaElement>(null);
  const keyboard = keyboardRef ?? localKeyboard;
  const composing = useRef(false);
  const composed = useRef<string | null>(null);
  const lastMove = useRef(0);
  const pressed = useRef(new Map<string, BrowserActionInput & { kind: 'key' }>());
  const latestFrame = useRef(frame);
  latestFrame.current = frame;
  const pointers = useRef(new Set<number>());
  const click = useRef<{
    x: number; y: number; lastX: number; lastY: number; at: number; dragged: boolean;
  } | null>(null);
  const handlers = useRef({ onAction, onAck, onError, disabled });
  handlers.current = { onAction, onAck, onError, disabled };

  const releasePressed = (): void => {
    for (const action of pressed.current.values()) {
      handlers.current.onAction({ ...action, event: 'up', modifiers: 0, repeat: false });
    }
    pressed.current.clear();
  };
  // 暂停、换页和卸载都可能收不到本机 keyup；会话层保留原标签并负责释放回执。
  useEffect(() => releasePressed, [disabled, frame?.tabId]);

  useEffect(() => {
    const element = keyboard.current;
    if (element === null) {
      return;
    }
    // 原生 beforeinput 含手机删除类型；React 的兼容事件不保证转发这些无文本输入。
    const beforeInput = (event: InputEvent): void => {
      if (handlers.current.disabled || latestFrame.current === null || composing.current || event.isComposing) {
        return;
      }
      let key: string;
      switch (event.inputType) {
        case 'deleteContentBackward':
          key = 'Backspace';
          break;
        case 'deleteContentForward':
          key = 'Delete';
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (![...pressed.current.values()].some((action) => action.key === key)) {
        handlers.current.onAction({ kind: 'key', key });
      }
      element.value = '';
    };
    element.addEventListener('beforeinput', beforeInput);
    return () => element.removeEventListener('beforeinput', beforeInput);
  }, [keyboard]);

  useEffect(() => {
    const element = surface.current;
    if (element === null) {
      return;
    }
    const wheel = (event: WheelEvent): void => {
      const current = latestFrame.current;
      if (current === null || handlers.current.disabled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      let factor = 1;
      if (event.deltaMode === 1) {
        factor = WHEEL_LINE_PX;
      } else if (event.deltaMode === 2) {
        factor = current.height;
      }
      const clamp = (value: number): number => Math.max(-MAX_SCROLL_PX, Math.min(MAX_SCROLL_PX, Math.round(value)));
      handlers.current.onAction({ kind: 'scroll', dx: clamp(event.deltaX * factor), dy: clamp(event.deltaY * factor),
        ...pagePoint(event.clientX, event.clientY, element.getBoundingClientRect(), current) });
    };
    // React 的 wheel 是被动监听，不能阻止浮层和远端页面同时滚；这里显式使用可取消的监听。
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  useEffect(() => {
    if (frame === null) {
      return;
    }
    let current = true;
    const image = new Image();
    image.onload = () => {
      if (!current || canvas.current === null) {
        return;
      }
      const target = canvas.current;
      target.width = image.width;
      target.height = image.height;
      const context = target.getContext('2d');
      if (context === null) {
        handlers.current.onError('画面无法绘制，请重试。');
        return;
      }
      context.drawImage(image, 0, 0);
      handlers.current.onAck(frame.sequence);
    };
    image.onerror = () => {
      if (current) {
        handlers.current.onError('画面没有加载出来，请重试。');
      }
    };
    image.src = `data:image/jpeg;base64,${frame.data}`;
    return () => { current = false; };
  }, [frame]);

  const key = (event: KeyboardEvent<HTMLElement>, type: 'down' | 'up'): void => {
    event.stopPropagation();
    const held = pressed.current.get(event.code);
    if (type === 'up' && held !== undefined) {
      event.preventDefault();
      pressed.current.delete(event.code);
      onAction({ ...held, event: 'up', modifiers: modifiers(event), repeat: false });
      return;
    }
    if (type === 'up' || disabled || frame === null) {
      return;
    }
    if (event.nativeEvent.isComposing || composing.current || ['Process', 'Unidentified', 'Dead'].includes(event.key)) {
      return;
    }
    composed.current = null;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      // 让本机产生受浏览器保护的 paste 事件，再只转发用户选择粘贴的纯文本。
      return;
    }
    // 可打印字符交给原生 input，保留键盘布局、死键和输入法。组合快捷键走 CDP 的按下/松开。
    if (event.key.length === 1
      && ((!event.ctrlKey && !event.metaKey && !event.altKey) || event.getModifierState('AltGraph'))) {
      return;
    }
    event.preventDefault();
    const action = { kind: 'key' as const, key: event.key, code: event.code, event: type,
      modifiers: modifiers(event), repeat: event.repeat };
    pressed.current.set(event.code, action);
    onAction(action);
  };

  return (
    <div ref={surface} className="browser-surface" role="group" aria-label="浏览器画面" tabIndex={0}
      aria-disabled={disabled || frame === null}
      onKeyDown={(event) => key(event, 'down')} onKeyUp={(event) => key(event, 'up')}
      onBlur={releasePressed}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        pointers.current.add(event.pointerId);
        if (disabled || event.button !== 0 || pointers.current.size > 1 || frame === null) {
          click.current = null;
          return;
        }
        event.preventDefault();
        click.current = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY,
          at: Date.now(), dragged: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        const started = click.current;
        click.current = null;
        // 移动手势不冒充点击；M6 手机不映射长按右键或双指缩放。
        if (!disabled && frame !== null && started !== null && !started.dragged
          && Date.now() - started.at < LONG_PRESS_MS
          && Math.hypot(event.clientX - started.x, event.clientY - started.y) < TAP_TOLERANCE_PX) {
          event.preventDefault();
          // 普通点按只聚焦画面；远端回执确认可编辑后再唤起文字键盘。
          event.currentTarget.focus({ preventScroll: true });
          onAction({ kind: 'click', ...pagePoint(event.clientX, event.clientY,
            event.currentTarget.getBoundingClientRect(), frame) }, (view) => {
            if (view.editableFocused && !handlers.current.disabled && view.activeTabId === latestFrame.current?.tabId
              && document.activeElement === surface.current) {
              keyboard.current?.focus({ preventScroll: true });
            }
          });
        }
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        click.current = null;
      }}
      onPointerMove={(event) => {
        if (disabled || frame === null) {
          return;
        }
        if (event.pointerType === 'touch') {
          const started = click.current;
          if (started === null || pointers.current.size !== 1) {
            return;
          }
          if (!started.dragged && Math.hypot(event.clientX - started.x, event.clientY - started.y) < TAP_TOLERANCE_PX) {
            return;
          }
          event.preventDefault();
          started.dragged = true;
          const dx = Math.round(started.lastX - event.clientX);
          const dy = Math.round(started.lastY - event.clientY);
          started.lastX = event.clientX;
          started.lastY = event.clientY;
          if (dx !== 0 || dy !== 0) {
            onAction({ kind: 'scroll', dx, dy, ...pagePoint(event.clientX, event.clientY,
              event.currentTarget.getBoundingClientRect(), frame) });
          }
          return;
        }
        if (Date.now() - lastMove.current < MOVE_INTERVAL_MS) {
          return;
        }
        lastMove.current = Date.now();
        onAction({ kind: 'move', ...pagePoint(event.clientX, event.clientY,
          event.currentTarget.getBoundingClientRect(), frame) });
      }}>
      <canvas ref={canvas} className="browser-canvas" aria-label="服务器浏览器的当前画面"
        style={frame === null ? undefined : { width: frame.width, height: frame.height }} />
      {frame === null ? <p className="browser-wait tool-sub">等待浏览器画面…</p> : null}
      <textarea ref={keyboard} className="browser-keyboard" aria-label="浏览器键盘输入"
        autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={disabled || frame === null}
        onCompositionStart={() => {
          composing.current = true;
          composed.current = null;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          const text = event.data || event.currentTarget.value;
          composed.current = text;
          event.currentTarget.value = '';
          if (!disabled && frame !== null && text !== '') {
            onAction({ kind: 'type', text });
          }
        }}
        onInput={(event) => {
          if (disabled || frame === null || composing.current) {
            return;
          }
          const text = event.currentTarget.value;
          event.currentTarget.value = '';
          if (text !== '' && text !== composed.current) {
            onAction({ kind: 'type', text });
          }
          composed.current = null;
        }}
        onPaste={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const text = event.clipboardData.getData('text/plain');
          if (!disabled && frame !== null && text !== '') {
            onAction({ kind: 'type', text });
          }
        }} />
    </div>
  );
}
