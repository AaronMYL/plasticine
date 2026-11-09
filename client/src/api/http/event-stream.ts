// 回答是 SSE 的请求（笔记续写边生成边显示，2026-11-09）：和 /v2/events 同一种写法，一条事件是若干行，`data: ` 开头的
// 行拼起来是这一条的内容，空行分隔。EventSource 只能 GET，续写要 POST 正文，所以这里自己从 fetch 的 body 读。
// 没有 body 的回答（测试的假 fetch、不支持流的环境）整段读完再拆，结果一样，只是不再边到边交。

import type { ResponseLike } from './transport.ts';

/** 一段文字里已经完整的事件交出去，返回还没完整的尾巴。 */
function drain(buffer: string, onData: (data: string) => void): string {
  const frames = buffer.split(/\r?\n\r?\n/);
  const rest = frames.pop() ?? '';
  for (const frame of frames) {
    const lines = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'));
    if (lines.length > 0) {
      onData(lines.map((line) => line.slice(line.startsWith('data: ') ? 6 : 5)).join('\n'));
    }
  }
  return rest;
}

/** 读完整个回答；onData 抛错就取消下面的流（连接随之断开），原样抛给调用方。 */
export async function readEventStream(response: ResponseLike, onData: (data: string) => void): Promise<void> {
  const body = response.body;
  if (body === undefined || body === null) {
    drain(`${await response.text()}\n\n`, onData);
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer = drain(buffer + decoder.decode(value, { stream: !done }), onData);
      if (done) {
        drain(`${buffer}\n\n`, onData);
        return;
      }
    }
  } catch (cause) {
    await reader.cancel(cause);
    throw cause;
  } finally {
    reader.releaseLock();
  }
}
