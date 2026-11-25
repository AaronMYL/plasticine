import type { ResponseLike } from './transport.ts';

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
