// 网页标签的 Chromium 调试协议（webContents.debugger）：整页截图、AI 操作整页要的可信输入（Input.dispatchMouseEvent /
// insertText）都走这里。同一个标签同一时间只挂一次；用完就摘，免得页面一直显示被调试。

import type { WebContents } from 'electron';

const PROTOCOL_VERSION = '1.3';

export type CdpSend = (method: string, params: Record<string, unknown>) => Promise<unknown>;

const busy = new WeakMap<WebContents, Promise<unknown>>();

/** 挂上调试器做一件事，做完摘下；同一个标签排队，不并发挂。 */
export async function withDebugger<T>(contents: WebContents, work: (send: CdpSend) => Promise<T>): Promise<T> {
  const before = busy.get(contents) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(async () => {
    const debug = contents.debugger;
    const attachedHere = !debug.isAttached();
    if (attachedHere) {
      debug.attach(PROTOCOL_VERSION);
    }
    try {
      return await work((method, params) => debug.sendCommand(method, params) as Promise<unknown>);
    } finally {
      if (attachedHere && debug.isAttached()) {
        debug.detach();
      }
    }
  });
  busy.set(contents, run);
  return run;
}

/** 在页面坐标（CSS 像素，相对视口）上点一下：可信的鼠标事件，和人点的一样。 */
export async function trustedClick(contents: WebContents, x: number, y: number): Promise<void> {
  await withDebugger(contents, async (send) => {
    const base = { x, y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  });
}

/** 往当前焦点里输入文字（输入法那条路，页面收到的是真的输入事件）。 */
export async function trustedInsert(contents: WebContents, text: string): Promise<void> {
  await withDebugger(contents, async (send) => {
    await send('Input.insertText', { text });
  });
}
