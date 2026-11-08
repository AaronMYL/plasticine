import type { BrowserAction } from './transports.ts';
import { cdpValue, CdpHistorySchema } from './cdp-protocol.ts';

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
// Windows virtual key codes are also the CDP protocol's cross-platform editing key identifiers.
const KEY_CODES: Readonly<Record<string, number>> = {
  Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, ' ': 32,
  PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39,
  ArrowDown: 40, Delete: 46, Meta: 91,
  Insert: 45, CapsLock: 20, NumLock: 144, ScrollLock: 145, Pause: 19, ContextMenu: 93, PrintScreen: 44,
};
const FUNCTION_KEY_BASE = 111;

function virtualKey(key: string): number {
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) {
    return FUNCTION_KEY_BASE + Number(key.slice(1));
  }
  return KEY_CODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
}

export async function dispatchInput(action: BrowserAction, send: CdpSend, release: CdpSend = send): Promise<void> {
  switch (action.kind) {
    case 'click':
      try {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: action.x, y: action.y,
          button: 'left', buttons: 1, clickCount: 1 });
      } finally {
        // 用户接手时也松开已送出的按下，避免后续操作变成拖拽。
        await release('Input.dispatchMouseEvent', { type: 'mouseReleased', x: action.x, y: action.y,
          button: 'left', buttons: 0, clickCount: 1 });
      }
      return;
    case 'move':
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: action.x, y: action.y });
      return;
    case 'scroll':
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: action.x ?? 0, y: action.y ?? 0,
        deltaX: action.dx ?? 0, deltaY: action.dy });
      return;
    case 'type':
      await send('Input.insertText', { text: action.text });
      return;
    case 'key': {
      const code = virtualKey(action.key);
      const params = { key: action.key, code: action.code ?? action.key, modifiers: action.modifiers ?? 0,
        windowsVirtualKeyCode: code, autoRepeat: action.repeat ?? false };
      const text = action.key === 'Enter' && action.event !== 'up' ? '\r' : '';
      try {
        await send('Input.dispatchKeyEvent', { ...params, type: action.event === 'up' ? 'keyUp' : 'keyDown', text });
      } finally {
        if (action.event === undefined) {
          await release('Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
        }
      }
      return;
    }
    case 'back':
    case 'forward': {
      const history = cdpValue(CdpHistorySchema, await send('Page.getNavigationHistory'));
      const entry = history.entries[history.currentIndex + (action.kind === 'back' ? -1 : 1)];
      if (entry !== undefined) {
        await send('Page.navigateToHistoryEntry', { entryId: entry.id });
      }
      return;
    }
    case 'reload':
      await send('Page.reload');
      return;
    case 'stop':
      await send('Page.stopLoading');
  }
}
