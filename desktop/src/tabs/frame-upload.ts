import type { WebContents } from 'electron';
import { withDebugger, type CdpSend } from './cdp.ts';

const ATTACH_WAIT_MS = 1_500;

type Send = CdpSend;

interface DomNode {
  nodeId?: number;
  nodeName?: string;
  attributes?: string[];
  children?: DomNode[];
  contentDocument?: DomNode;
  shadowRoots?: DomNode[];
}

interface FrameSession {
  sessionId: string;
  targetId: string;
  url: string;
}

function findMarked(node: DomNode | undefined, nonce: string): number | null {
  if (node === undefined) {
    return null;
  }
  const attributes = node.attributes ?? [];
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    if (attributes[index] === 'data-plasticine-upload' && attributes[index + 1] === nonce
      && node.nodeName === 'INPUT' && node.nodeId !== undefined) {
      return node.nodeId;
    }
  }
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? []),
    ...(node.contentDocument === undefined ? [] : [node.contentDocument])]) {
    const found = findMarked(child, nonce);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

async function withFrames<T>(contents: WebContents, work: (send: Send, frames: () => FrameSession[]) => Promise<T>)
  : Promise<T> {
  return withDebugger(contents, async (send) => {
    const debug = contents.debugger;
    const sessions: FrameSession[] = [];
    const listen = (_event: unknown, method: string, params: { sessionId?: string;
      targetInfo?: { targetId?: string; type?: string; url?: string } }): void => {
      const info = params.targetInfo;
      if (method === 'Target.attachedToTarget' && typeof params.sessionId === 'string' && info?.type === 'iframe') {
        sessions.push({ sessionId: params.sessionId, targetId: String(info.targetId ?? ''),
          url: String(info.url ?? '') });
      }
    };
    debug.on('message', listen);
    try {
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      return await work(send, () => [...sessions]);
    } finally {
      debug.off('message', listen);
      await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
        .catch(() => undefined);
    }
  });
}

async function markedIn(send: Send, nonce: string, sessionId?: string): Promise<number | null> {
  const document = await send('DOM.getDocument', { depth: -1, pierce: true }, sessionId) as { root?: DomNode };
  return findMarked(document.root, nonce);
}

async function waitSessions(frames: () => FrameSession[], wanted: (session: FrameSession) => boolean)
  : Promise<FrameSession[]> {
  const deadline = Date.now() + ATTACH_WAIT_MS;
  while (Date.now() < deadline && !frames().some(wanted)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return frames();
}

export async function setMarkedFilesAnywhere(contents: WebContents, nonce: string, files: readonly string[])
  : Promise<boolean> {
  return withFrames(contents, async (send, frames) => {
    const found = await markedIn(send, nonce);
    if (found !== null) {
      await send('DOM.setFileInputFiles', { nodeId: found, files: [...files] });
      return true;
    }
    for (const session of await waitSessions(frames, () => true)) {
      const inFrame = await markedIn(send, nonce, session.sessionId).catch(() => null);
      if (inFrame !== null) {
        await send('DOM.setFileInputFiles', { nodeId: inFrame, files: [...files] }, session.sessionId);
        return true;
      }
    }
    return false;
  });
}

export async function chooserInFrame(contents: WebContents, frameUrl: string, center: { x: number; y: number },
  files: readonly string[], waitMs: number): Promise<boolean> {
  return withFrames(contents, async (send, frames) => {
    const session = (await waitSessions(frames, (item) => item.url === frameUrl)).find((item) => item.url === frameUrl);
    if (session === undefined) {
      return false;
    }
    const owner = await send('DOM.getFrameOwner', { frameId: session.targetId }) as { backendNodeId?: number };
    const box = await send('DOM.getBoxModel', { backendNodeId: owner.backendNodeId }) as {
      model?: { content?: number[] } };
    const quad = box.model?.content;
    if (quad === undefined || quad.length < 2) {
      return false;
    }
    const x = (quad[0] ?? 0) + center.x;
    const y = (quad[1] ?? 0) + center.y;
    const debug = contents.debugger;
    let opened: ((node: number) => void) | null = null;
    const chooser = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), waitMs);
      opened = (node) => {
        clearTimeout(timer);
        resolve(node);
      };
    });
    const listen = (_event: unknown, method: string, params: { backendNodeId?: number }, sessionId?: string): void => {
      if (method === 'Page.fileChooserOpened' && sessionId === session.sessionId
        && typeof params.backendNodeId === 'number') {
        opened?.(params.backendNodeId);
      }
    };
    debug.on('message', listen);
    try {
      await send('Page.enable', {}, session.sessionId);
      await send('Page.setInterceptFileChooserDialog', { enabled: true }, session.sessionId);
      const base = { x, y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', button: 'none', clickCount: 0 });
      await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
      await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
      const node = await chooser;
      if (node === null) {
        return false;
      }
      await send('DOM.setFileInputFiles', { backendNodeId: node, files: [...files] }, session.sessionId);
      return true;
    } finally {
      debug.off('message', listen);
      await send('Page.setInterceptFileChooserDialog', { enabled: false }, session.sessionId).catch(() => undefined);
    }
  });
}
