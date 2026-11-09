// 网页标签垫在界面下面时，界面 preload 截下的鼠标事件怎么交给标签（tab-layering.ts）。
// webContents.sendInputEvent 只送到页面主框架：跨站 iframe（「用 Google 登录」按钮、人机验证、嵌入的视频）里点不到
// （11-09 在 Electron 45.2.3 上实测：点在跨站 iframe 上，收到的是外层页面）。按下、抬起、移动改走调试协议的
// Input.dispatchMouseEvent，和真鼠标一样按位置分给各个框架；滚轮照旧 sendInputEvent（主页面滚得动，手感不变）。
// 调试器挂上就不摘（cdp.ts 的 withDebugger 见到已经挂着就不摘），标签关掉时随之没了。

import type { WebContents } from 'electron';

const PROTOCOL_VERSION = '1.3';

/** 界面 preload 发来的鼠标事件（Electron MouseInputEvent 的形状，坐标是窗口里的）。 */
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
/** 调试协议的修饰键位：Alt 1、Ctrl 2、Meta 4、Shift 8。 */
const MODIFIER_BITS: Readonly<Record<string, number>> = { alt: 1, control: 2, meta: 4, shift: 8 };
/** 按住的鼠标键位：左 1、右 2、中 4。 */
const BUTTON_BITS: Readonly<Record<string, number>> = { leftButtonDown: 1, rightButtonDown: 2,
  middleButtonDown: 4 };
const BUTTONS: ReadonlySet<string> = new Set(['left', 'middle', 'right']);

/** 换成 Input.dispatchMouseEvent 的参数（坐标减去标签左上角）；滚轮等别的事件是 null。 */
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
  // 移动时的 button 是「按住的那个」：没按着就是 none。
  const button = type === 'mouseMoved' && buttons === 0 ? 'none' : named;
  if (type === 'mouseReleased') {
    buttons &= ~(BUTTON_BITS[`${named}ButtonDown`] ?? 0);
  }
  return { type, x: Math.round(input.x - origin.x), y: Math.round(input.y - origin.y), button, buttons,
    clickCount: type === 'mouseMoved' ? 0 : input.clickCount ?? 1, modifiers };
}

/** 把一个截下来的鼠标事件交给标签：按下、抬起、移动走调试协议，其余 sendInputEvent。 */
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
      // 挂不上（比如别的调试器占着）：退回 sendInputEvent，主页面照样点得到。
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
