import { errorCategory, safeLog } from '../util/index.ts';
import { toApiError } from './api-error.ts';
import type { HandlerResult, RequestContext } from './context.ts';

type ErrorBody = ReturnType<ReturnType<typeof toApiError>['error']['body']>;
export type SseEvent<Done> = { type: 'text'; delta: string } | { type: 'done'; view: Done }
  | { type: 'error'; error: ErrorBody };

export async function streamReply<Done>(context: RequestContext,
  run: (signal: AbortSignal, onText: (delta: string) => void) => Promise<Done>): Promise<HandlerResult> {
  const { res } = context;
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  res.once('close', abort);
  let started = false;
  const write = (event: SseEvent<Done>): void => {
    if (controller.signal.aborted || res.writableEnded) {
      return;
    }
    if (!started) {
      started = true;
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
        connection: 'keep-alive', 'x-accel-buffering': 'no' });
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    const view = await run(controller.signal, (delta) => write({ type: 'text', delta }));
    write({ type: 'done', view });
  } catch (error) {
    if (controller.signal.aborted) {
      res.end();
      return 'streamed';
    }
    if (!started) {
      throw error;
    }
    const mapped = toApiError(error);
    if (mapped.unexpected) {
      safeLog('error', 'request_failed', { category: errorCategory(error) });
    }
    write({ type: 'error', error: mapped.error.body() });
  } finally {
    res.off('close', abort);
  }
  res.end();
  return 'streamed';
}
