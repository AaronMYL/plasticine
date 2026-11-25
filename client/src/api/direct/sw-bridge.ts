import type { DirectChannel, DirectRequest } from './direct-channel.ts';

interface FetchMessage {
  type: 'plasticine-direct-fetch';
  method: string;
  path: string;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
}

function isFetchMessage(value: unknown): value is FetchMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['type'] === 'plasticine-direct-fetch' && typeof record['method'] === 'string'
    && typeof record['path'] === 'string' && typeof record['headers'] === 'object' && record['headers'] !== null
    && (record['body'] === null || record['body'] instanceof ArrayBuffer);
}

export function serveDirect(channel: DirectChannel, message: FetchMessage, port: MessagePort): void {
  port.postMessage({ type: 'ack' });
  const request: DirectRequest = { method: message.method, path: message.path, headers: message.headers,
    body: message.body };
  const sent = channel.send(request, {
    head: (reply) => {
      port.postMessage({ type: 'head', status: reply.status, headers: reply.headers });
    },
    chunk: (data) => {
      const copy = data.slice();
      port.postMessage({ type: 'chunk', data: copy.buffer }, [copy.buffer]);
    },
    end: () => {
      port.postMessage({ type: 'end' });
      port.close();
    },
    error: () => {
      port.postMessage({ type: 'error' });
      port.close();
    },
  });
  if (!sent.sent) {
    port.postMessage({ type: 'fallback', sent: false });
    port.close();
    return;
  }
  port.onmessage = (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === 'abort') {
      sent.abort();
      port.close();
    }
  };
}

export function installDirectBridge(channel: DirectChannel, container: ServiceWorkerContainer): () => void {
  const listener = (event: MessageEvent): void => {
    const port = event.ports[0];
    if (port === undefined || !isFetchMessage(event.data)) return;
    serveDirect(channel, event.data, port);
  };
  container.addEventListener('message', listener);
  container.startMessages?.();
  return () => container.removeEventListener('message', listener);
}
