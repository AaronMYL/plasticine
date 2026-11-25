import type { WebContents } from 'electron';

const PROTOCOL_VERSION = '1.3';

export type CdpSend = (method: string, params: Record<string, unknown>, sessionId?: string) => Promise<unknown>;

const busy = new WeakMap<WebContents, Promise<unknown>>();

export async function withDebugger<T>(contents: WebContents, work: (send: CdpSend) => Promise<T>): Promise<T> {
  const before = busy.get(contents) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(async () => {
    const debug = contents.debugger;
    const attachedHere = !debug.isAttached();
    if (attachedHere) {
      debug.attach(PROTOCOL_VERSION);
    }
    try {
      const send: CdpSend = (method, params, sessionId) =>
        debug.sendCommand(method, params, sessionId) as Promise<unknown>;
      return await work(send);
    } finally {
      if (attachedHere && debug.isAttached()) {
        debug.detach();
      }
    }
  });
  busy.set(contents, run);
  return run;
}

export async function trustedClick(contents: WebContents, x: number, y: number): Promise<void> {
  await withDebugger(contents, async (send) => {
    const base = { x, y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  });
}

const DRAG_STEPS = 10;

export async function trustedHover(contents: WebContents, x: number, y: number): Promise<void> {
  await withDebugger(contents, async (send) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  });
}

export async function trustedDrag(contents: WebContents, from: { x: number; y: number },
  to: { x: number; y: number }): Promise<void> {
  await withDebugger(contents, async (send) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from, button: 'none', clickCount: 0 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1,
      clickCount: 1 });
    for (let step = 1; step <= DRAG_STEPS; step += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + ((to.x - from.x) * step) / DRAG_STEPS,
        y: from.y + ((to.y - from.y) * step) / DRAG_STEPS, button: 'left', buttons: 1, clickCount: 0 });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0,
      clickCount: 1 });
  });
}

export async function trustedInsert(contents: WebContents, text: string): Promise<void> {
  await withDebugger(contents, async (send) => {
    await send('Input.insertText', { text });
  });
}

export async function trustedWheel(contents: WebContents, x: number, y: number, dy: number): Promise<void> {
  await withDebugger(contents, async (send) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
  });
}

export interface KeyStroke {
  key: string;
  code: string;
  keyCode: number;
  modifiers: number;
  text: string;
  commands: string[];
}

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
