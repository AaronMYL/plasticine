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

/** 在画面上这个位置滚（可信的滚轮事件，滚的是指着的那一块，和人用滚轮一样）。 */
export async function trustedWheel(contents: WebContents, x: number, y: number, dy: number): Promise<void> {
  await withDebugger(contents, async (send) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
  });
}

/** 一个键在调试协议里的样子（key-spec.ts 换出来的）。 */
export interface KeyStroke {
  key: string;
  code: string;
  keyCode: number;
  modifiers: number;
  /** 打出来的字（只有不带 ⌘ / Ctrl / Alt 的字母、数字、空格有）。 */
  text: string;
  /** Mac 上 ⌘A 这类编辑命令要显式带上，调试协议发的键不会自己触发。 */
  commands: string[];
}

/** 按一下这个键（按下、松开），和人按的一样可信。 */
export async function trustedKey(contents: WebContents, stroke: KeyStroke): Promise<void> {
  await withDebugger(contents, async (send) => {
    const base = { key: stroke.key, code: stroke.code, windowsVirtualKeyCode: stroke.keyCode,
      nativeVirtualKeyCode: stroke.keyCode, modifiers: stroke.modifiers };
    await send('Input.dispatchKeyEvent', { ...base, type: stroke.text === '' ? 'rawKeyDown' : 'keyDown',
      ...(stroke.text === '' ? {} : { text: stroke.text, unmodifiedText: stroke.text }),
      ...(stroke.commands.length === 0 ? {} : { commands: stroke.commands }) });
    await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  });
}

/** 文件放进打了记号的文件框（调试协议的 DOM.setFileInputFiles，页面收到 input / change，和人选的一样）。 */
export async function setMarkedFiles(contents: WebContents, nonce: string, files: readonly string[]): Promise<boolean> {
  return withDebugger(contents, async (send) => {
    const document = await send('DOM.getDocument', { depth: 0 }) as { root?: { nodeId?: number } };
    const rootId = document.root?.nodeId;
    if (rootId === undefined) {
      return false;
    }
    const found = await send('DOM.querySelector', { nodeId: rootId,
      selector: `input[type=file][data-plasticine-upload="${nonce}"]` }) as { nodeId?: number };
    if (found.nodeId === undefined || found.nodeId === 0) {
      return false;
    }
    await send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [...files] });
    return true;
  });
}

/**
 * 点了会弹「选择文件」的按钮：先接管选择文件窗口（不弹给他），在按钮中心可信地点一下，接住弹出来的那一次，把文件
 * 放进去。等不到弹出（按钮其实不选文件）回 false。
 */
export async function uploadThroughChooser(contents: WebContents, x: number, y: number, files: readonly string[],
  waitMs: number): Promise<boolean> {
  return withDebugger(contents, async (send) => {
    const debug = contents.debugger;
    let opened: ((node: number) => void) | null = null;
    const chooser = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), waitMs);
      opened = (node) => {
        clearTimeout(timer);
        resolve(node);
      };
    });
    const listen = (_event: unknown, method: string, params: { backendNodeId?: number }): void => {
      if (method === 'Page.fileChooserOpened' && typeof params.backendNodeId === 'number') {
        opened?.(params.backendNodeId);
      }
    };
    debug.on('message', listen);
    try {
      await send('Page.enable', {});
      await send('Page.setInterceptFileChooserDialog', { enabled: true });
      const base = { x, y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', clickCount: 0 });
      await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
      await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
      const node = await chooser;
      if (node === null) {
        return false;
      }
      await send('DOM.setFileInputFiles', { backendNodeId: node, files: [...files] });
      return true;
    } finally {
      debug.off('message', listen);
      await send('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined);
    }
  });
}
