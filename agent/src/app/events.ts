import type { HubStreamEvent } from '../../shared/api/index.ts';
import { stillAuthenticated } from './auth.ts';
import { SSE_MAX_PENDING_BYTES, SSE_RETRY_MS } from './config.ts';
import { requireAuth, type HandlerResult, type RequestContext } from './context.ts';
import type { HubEvent } from './event-hub.ts';
import { checkFeedItemView } from './daily-views.ts';

function frame(event: HubStreamEvent, id: string | null): string {
  const idLine = id === null ? '' : `id: ${id}\n`;
  const body = event.type === 'feed_item_changed' ? { ...event, item: checkFeedItemView(event.item) } : event;
  return `${idLine}event: ${event.type}\ndata: ${JSON.stringify(body)}\n\n`;
}

function lastEventId(context: RequestContext): string | null {
  const header = context.req.headers['last-event-id'];
  if (typeof header === 'string' && header !== '') {
    return header;
  }
  return context.url.searchParams.get('lastEventId');
}

/** GET /v2/events */
export function streamEvents(context: RequestContext): HandlerResult {
  const auth = requireAuth(context);
  const { req, res } = context;
  const { hub, sseHeartbeatMs } = context.deps;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);
  let closed = false;
  const owner = { sessionId: auth.session.id, deviceId: auth.device.id };
  const resumeFrom = lastEventId(context);
  const startId = resumeFrom === null ? hub.cursor() : null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  const end = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    clearInterval(heartbeat);
    subscription?.unsubscribe();
    res.end();
  };
  const write = (entry: HubEvent): void => {
    if (closed) {
      return;
    }
    if (res.writableLength > SSE_MAX_PENDING_BYTES) {
      end();
      return;
    }
    res.write(frame(entry.event, entry.id));
  };
  const opened = hub.subscribe(owner, resumeFrom, write, end);
  subscription = opened;
  res.write(frame({ type: 'ready', resync: opened.resync }, startId));
  for (const entry of opened.replay) {
    write(entry);
  }
  if (closed) {
    return 'streamed';
  }
  heartbeat = setInterval(() => {
    if (!stillAuthenticated(context.deps, auth)) {
      end();
      return;
    }
    res.write(': ping\n\n');
  }, sseHeartbeatMs);
  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    subscription?.unsubscribe();
  });
  return 'streamed';
}
