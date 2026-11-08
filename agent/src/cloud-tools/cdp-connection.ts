import { CloudToolError } from './errors.ts';
import { cdpValue, CdpEnvelopeSchema, CdpVersionSchema, type CdpEvent } from './cdp-protocol.ts';

// 本机 CDP 命令十秒无回执即失败；导航的页面加载不会阻塞此命令回执。
const COMMAND_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_CHARS = 4_500_000;
export const BROWSER_UNAVAILABLE = '浏览器还没起来，请重试。';

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}

export class CdpConnection {
  readonly #socket: WebSocket;
  readonly #pending = new Map<number, Pending>();
  readonly #listeners = new Set<(event: CdpEvent) => void>();
  readonly #onClose: () => void;
  #next = 0;
  #closed = false;

  private constructor(socket: WebSocket, onClose: () => void) {
    this.#socket = socket;
    this.#onClose = onClose;
    socket.addEventListener('message', (event) => {
      try {
        if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_CHARS) {
          throw new CloudToolError('unknown', '浏览器画面过大，请重试。');
        }
        const message = cdpValue(CdpEnvelopeSchema, JSON.parse(event.data));
        if (message.id !== undefined) {
          const pending = this.#pending.get(message.id);
          this.#pending.delete(message.id);
          pending?.cleanup();
          if (message.error !== undefined) {
            pending?.reject(new CloudToolError('unknown', '浏览器没有完成操作，请核对画面后再试。'));
          } else {
            pending?.resolve(message.result ?? {});
          }
        } else {
          for (const listener of this.#listeners) {
            listener(message);
          }
        }
      } catch {
        // 丢掉无法安全解码的连接；调用者收到统一的断线状态，可重新连接。
        this.close();
      }
    });
    socket.addEventListener('close', () => this.close());
    socket.addEventListener('error', () => this.close());
  }

  static async connect(endpoint: string, signal: AbortSignal, onClose: () => void): Promise<CdpConnection> {
    const base = new URL(endpoint);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password) {
      throw new CloudToolError('invalid_input', '浏览器调试连接只能使用 127.0.0.1。');
    }
    const limited = AbortSignal.any([signal, AbortSignal.timeout(COMMAND_TIMEOUT_MS)]);
    let socket: WebSocket | undefined;
    try {
      const response = await fetch(new URL('/json/version', base), { signal: limited, redirect: 'error' });
      if (!response.ok) {
        throw new Error('CDP discovery failed');
      }
      const version = cdpValue(CdpVersionSchema, await response.json());
      const url = new URL(version.webSocketDebuggerUrl);
      if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== base.port
        || url.username || url.password || !url.pathname.startsWith('/devtools/browser/')) {
        throw new Error('CDP endpoint mismatch');
      }
      socket = new WebSocket(url);
      const connecting = socket;
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          limited.removeEventListener('abort', abort);
          connecting.removeEventListener('error', fail);
          connecting.removeEventListener('open', opened);
        };
        const abort = (): void => {
          cleanup();
          reject(new Error('CDP connection cancelled'));
        };
        const fail = (): void => {
          cleanup();
          reject(new Error('CDP connection failed'));
        };
        const opened = (): void => {
          cleanup();
          resolve();
        };
        connecting.addEventListener('open', opened, { once: true });
        connecting.addEventListener('error', fail, { once: true });
        limited.addEventListener('abort', abort, { once: true });
        if (limited.aborted) {
          abort();
        }
      });
      return new CdpConnection(socket, onClose);
    } catch {
      socket?.close();
      signal.throwIfAborted();
      throw new CloudToolError('not_configured', BROWSER_UNAVAILABLE);
    }
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  send(method: string, params: Record<string, unknown>, signal: AbortSignal, sessionId?: string): Promise<unknown> {
    signal.throwIfAborted();
    if (this.#closed) {
      return Promise.reject(new CloudToolError('unknown', '浏览器连接断开了，请重试并核对画面。'));
    }
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        this.#pending.delete(id);
        cleanup();
        reject(signal.reason);
      };
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        cleanup();
        reject(new CloudToolError('unknown', '浏览器操作超时，请核对画面后重试。'));
      }, COMMAND_TIMEOUT_MS);
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      };
      this.#pending.set(id, { resolve, reject, cleanup });
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.#socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch {
        this.#pending.delete(id);
        cleanup();
        reject(new CloudToolError('unknown', '浏览器连接断开了，请重试并核对画面。'));
        this.close();
      }
    });
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(new CloudToolError('unknown', '浏览器连接断开了，请重试并核对画面。'));
    }
    this.#pending.clear();
    this.#listeners.clear();
    this.#socket.close();
    this.#onClose();
  }
}
