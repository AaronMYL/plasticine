// 边生成边送的 SSE 回答（笔记续写 2026-11-09 起；11-13 预测消息共用）：只送给发请求的这一页，不进事件总线（总线是广播
// 加补播缓冲，打字时一秒好几段的增量会挤掉别的事件，也会推到别的设备上）。头等第一段字到了再发：那之前失败（没连
// 模型、额度用完）照旧回普通的错误回答。页面断开（打字作废、换段）就叫停模型。

import { cleanOutboundJson } from '../outbound.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
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
    // 出口清洗和普通回答一样（链接里的账号密码）；最终文字在 done 里整段再清一次。
    res.write(`data: ${JSON.stringify(cleanOutboundJson(event))}\n\n`);
  };
  try {
    const view = await run(controller.signal, (delta) => write({ type: 'text', delta }));
    write({ type: 'done', view });
  } catch (error) {
    if (!started) {
      throw error;
    }
    const mapped = toApiError(error);
    if (mapped.unexpected) {
      // 和 server.ts 的错误出口一样只记类别；头已经发出，错误改成流里最后一条。
      safeLog('error', 'request_failed', { category: errorCategory(error) });
    }
    write({ type: 'error', error: mapped.error.body() });
  } finally {
    res.off('close', abort);
  }
  res.end();
  return 'streamed';
}
