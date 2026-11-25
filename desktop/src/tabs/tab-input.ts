import type { WebContents } from 'electron';

const PROTOCOL_VERSION = '1.3';

export interface ForwardedMouse {
  type: string;
  x: number;
  y: number;
  modifiers: readonly string[];
  button?: string;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface CdpMouseParams {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved';
  x: number;
  y: number;
  button: 'none' | 'left' | 'middle' | 'right';
  buttons: number;
  clickCount: number;
  modifiers: number;
}

const TYPES: Readonly<Record<string, CdpMouseParams['type']>> = { mouseDown: 'mousePressed',
  mouseUp: 'mouseReleased', mouseMove: 'mouseMoved' };
const MODIFIER_BITS: Readonly<Record<string, number>> = { alt: 1, control: 2, meta: 4, shift: 8 };
const BUTTON_BITS: Readonly<Record<string, number>> = { leftButtonDown: 1, rightButtonDown: 2,
  middleButtonDown: 4 };
const BUTTONS: ReadonlySet<string> = new Set(['left', 'middle', 'right']);

export function cdpMouseEvent(input: ForwardedMouse, origin: { x: number; y: number }): CdpMouseParams | null {
  const type = TYPES[input.type];
  if (type === undefined) {
    return null;
  }
  let modifiers = 0;
  let buttons = 0;
  for (const name of input.modifiers) {
    modifiers |= MODIFIER_BITS[name] ?? 0;
    buttons |= BUTTON_BITS[name] ?? 0;
  }
  const named = input.button !== undefined && BUTTONS.has(input.button) ? input.button as CdpMouseParams['button']
    : 'left';
  const button = type === 'mouseMoved' && buttons === 0 ? 'none' : named;
  if (type === 'mouseReleased') {
    buttons &= ~(BUTTON_BITS[`${named}ButtonDown`] ?? 0);
  }
  return { type, x: Math.round(input.x - origin.x), y: Math.round(input.y - origin.y), button, buttons,
    clickCount: type === 'mouseMoved' ? 0 : input.clickCount ?? 1, modifiers };
}

export function dispatchMouse(contents: WebContents, input: ForwardedMouse, origin: { x: number; y: number },
  log: (line: string) => void): void {
  const params = cdpMouseEvent(input, origin);
  if (params === null) {
    contents.sendInputEvent({ ...input, x: Math.round(input.x - origin.x), y: Math.round(input.y - origin.y),
      modifiers: [...input.modifiers] } as Electron.MouseWheelInputEvent);
    return;
  }
  const debug = contents.debugger;
  if (!debug.isAttached()) {
    try {
      debug.attach(PROTOCOL_VERSION);
    } catch (error) {
      log(`网页标签的调试器挂不上，鼠标改用 sendInputEvent：${error instanceof Error ? error.message : String(error)}`);
      contents.sendInputEvent({ ...input, x: params.x, y: params.y, modifiers: [...input.modifiers] } as
        Electron.MouseInputEvent);
      return;
    }
  }
  debug.sendCommand('Input.dispatchMouseEvent', { ...params }).catch((error: unknown) => {
    log(`鼠标没交给网页标签：${error instanceof Error ? error.message : String(error)}`);
  });
}
