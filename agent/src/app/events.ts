// /v2/events: the Server-Sent Events stream. A reconnect sends Last-Event-ID (the browser does it by itself) and
// gets what it missed from the buffer, or `ready` with resync when that is no longer possible. Since M2 the stream
// also carries the task and card events (shared/api/task-events.ts).

import type { HubStreamEvent } from '../../shared/api/index.ts';
import { cleanOutboundJson } from '../outbound.ts';
import type { StateService } from '../state/index.ts';
import { stillAuthenticated } from './auth.ts';
import { SSE_MAX_PENDING_BYTES, SSE_RETRY_MS } from './config.ts';
import { requireAuth, type HandlerResult, type RequestContext } from './context.ts';
import type { HubEvent } from './event-hub.ts';
import { cleanFeedItemView } from './daily-views.ts';
import { eventTextPolicy } from './outbound-policy.ts';

function frame(event: HubStreamEvent, id: string | null, state: StateService): string {
  const idLine = id === null ? '' : `id: ${id}\n`;
  const cleaned = event.type === 'feed_item_changed' ? { ...event, item: cleanFeedItemView(event.item) } : event;
  const body = cleanOutboundJson(cleaned, eventTextPolicy(cleaned, state));
  return `${idLine}event: ${event.type}\ndata: ${JSON.stringify(body)}\n\n`;
}

function lastEventId(context: RequestContext): string | null {
  const header = context.req.headers['last-event-id'];
  if (typeof header === 'string' && header !== '') {
    return header;
  }
  // EventSource cannot set headers on its first connection; a client resuming by hand may pass it here.
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
    // Some proxies buffer responses unless told not to; Caddy flushes event streams by itself.
    'x-accel-buffering': 'no',
  });
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);
  let closed = false;
  const owner = { sessionId: auth.session.id, deviceId: auth.device.id };
  const resumeFrom = lastEventId(context);
  // A fresh stream starts at the hub's current position; a resumed one keeps the position it came with until the
  // replay below has moved it on (an id on `ready` would skip what the replay has not delivered yet).
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
    // A client that does not read must not make this process hold its events for ever (review-followups 908a81e):
    // past the limit the stream ends and the client reconnects with its Last-Event-ID.
    if (res.writableLength > SSE_MAX_PENDING_BYTES) {
      end();
      return;
    }
    res.write(frame(entry.event, entry.id, context.deps.state));
  };
  const opened = hub.subscribe(owner, resumeFrom, write, end);
  subscription = opened;
  res.write(frame({ type: 'ready', resync: opened.resync }, startId, context.deps.state));
  for (const entry of opened.replay) {
    write(entry);
  }
  if (closed) {
    // The replay alone went past the pending limit and ended the stream: no heartbeat on a finished response.
    return 'streamed';
  }
  // The stream authenticated once, when it opened. Logout and device revocation close it at once (session.ts,
  // devices.ts); an expiry has no such moment, so every heartbeat checks the session again first.
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
