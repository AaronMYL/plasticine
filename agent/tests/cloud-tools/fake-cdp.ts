// 只监听随机回环端口的 CDP 替身；握手和帧遵循 RFC 6455，不启动浏览器、不访问外网。
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';

export interface Command {
  id: number;
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

function packet(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(payload.length < 126 ? 2 : 4);
  header[0] = 0x81;
  header[1] = payload.length < 126 ? payload.length : 126;
  if (payload.length >= 126) {
    header.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([header, payload]);
}

export async function fakeCdp() {
  const commands: Command[] = [];
  const sockets = new Set<Duplex>();
  const tabs = new Map([['tab-1', { targetId: 'tab-1', type: 'page', title: '示例', url: 'about:blank' }]]);
  let nextTab = 1;
  let port = 0;
  let hold: string | null = null;
  const held: { command: Command; socket: Duplex }[] = [];
  let scrollY = 0;
  let editable = false;
  let elementLabel = '编辑';
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake` }));
  });
  function result(command: Command): Record<string, unknown> {
    const { method, params } = command;
    if (method === 'Browser.getWindowForTarget') {
      return { windowId: 1 };
    }
    if (method === 'Page.getFrameTree') {
      return { frameTree: { frame: { id: 'frame-1' } } };
    }
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { pageX: 0, pageY: scrollY } };
    }
    if (method === 'Input.dispatchMouseEvent' && params['type'] === 'mouseWheel') {
      scrollY += Number(params['deltaY']);
    }
    if (method === 'Target.getTargets') {
      return { targetInfos: [...tabs.values()] };
    }
    if (method === 'Target.attachToTarget') {
      return { sessionId: `session-${String(params['targetId'])}` };
    }
    if (method === 'Target.createTarget') {
      const targetId = `tab-${++nextTab}`;
      tabs.set(targetId, { targetId, type: 'page', title: '新标签页', url: String(params['url']) });
      return { targetId };
    }
    if (method === 'Target.closeTarget') {
      tabs.delete(String(params['targetId']));
      return { success: true };
    }
    if (method === 'Page.navigate') {
      const tab = tabs.get(command.sessionId?.replace('session-', '') ?? 'tab-1');
      if (tab !== undefined) {
        tab.url = String(params['url']);
      }
      return { frameId: 'frame-1' };
    }
    if (method === 'Page.getNavigationHistory') {
      return { currentIndex: 1, entries: [{ id: 1 }, { id: 2 }, { id: 3 }] };
    }
    if (method === 'Runtime.evaluate') {
      if (String(params['expression']).includes('__plasticineObservation')) {
        const tab = tabs.get(command.sessionId?.replace('session-', '') ?? 'tab-1');
        return { result: { type: 'object', value: { url: tab?.url ?? '', title: tab?.title ?? '',
          documentId: 1, text: '可读的页面', viewport: { width: 1280, height: 800, scrollX: 0, scrollY },
          elements: [{ id: 'e1', tag: 'button', role: 'button', text: elementLabel, label: '', disabled: false,
            focused: false, bounds: { x: 10, y: 20, width: 100, height: 40 } }] } } };
      }
      if (String(params['expression']).includes('document.activeElement')) {
        return { result: { type: 'boolean', value: editable } };
      }
      return { result: { type: 'string', value: '可读的页面' } };
    }
    if (method === 'Page.captureScreenshot') {
      return { data: Buffer.from('png').toString('base64') };
    }
    return {};
  }
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const opcode = (pending[0] ?? 0) & 15;
        let size = (pending[1] ?? 0) & 127;
        let offset = 2;
        if (size === 126) {
          if (pending.length < 4) {
            return;
          }
          size = pending.readUInt16BE(2);
          offset = 4;
        } else if (size === 127) {
          if (pending.length < 10) {
            return;
          }
          size = Number(pending.readBigUInt64BE(2));
          offset = 10;
        }
        if (pending.length < offset + 4 + size) {
          return;
        }
        const mask = pending.subarray(offset, offset + 4);
        const data = Buffer.from(pending.subarray(offset + 4, offset + 4 + size));
        pending = pending.subarray(offset + 4 + size);
        for (let i = 0; i < data.length; i += 1) {
          data[i] = (data[i] ?? 0) ^ (mask[i % 4] ?? 0);
        }
        if (opcode === 8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        const command = JSON.parse(data.toString()) as Command;
        commands.push(command);
        if (command.method === hold) {
          held.push({ command, socket });
        } else {
          const missing = command.method === 'Page.stopScreencast'
            && !tabs.has(command.sessionId?.replace('session-', '') ?? '');
          const reply = missing ? { error: { message: 'Session closed' } } : { result: result(command) };
          socket.write(packet({ id: command.id, ...reply, sessionId: command.sessionId }));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('假 CDP 没有端口');
  }
  port = address.port;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    commands,
    editable(value: boolean) { editable = value; },
    elementLabel(value: string) { elementLabel = value; },
    hold(method: string | null) { hold = method; },
    release() {
      hold = null;
      for (const { command, socket } of held.splice(0)) {
        socket.write(packet({ id: command.id, result: result(command), sessionId: command.sessionId }));
      }
    },
    event(method: string, params: Record<string, unknown>, target = 'tab-1') {
      for (const socket of sockets) {
        socket.write(packet({ method, params, sessionId: `session-${target}` }));
      }
    },
    frame(id: number, target = 'tab-1') {
      for (const socket of sockets) {
        socket.write(packet({ method: 'Page.screencastFrame', sessionId: `session-${target}`, params: {
          sessionId: id, data: Buffer.from(`frame-${id}`).toString('base64'),
          metadata: { deviceWidth: 1280, deviceHeight: 800, pageScaleFactor: 1, offsetTop: 0 },
        } }));
      }
    },
    disconnect() {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
