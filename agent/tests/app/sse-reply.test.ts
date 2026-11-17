// 边生成边送的回答（app/sse-reply.ts）：页面自己断开（接着打字、换了一段）时模型跟着叫停，这不算服务出错——不记
// request_failed、不抛给外层回 500；真出错的照旧：头还没发就抛出去，头发过了就在流里回最后一条 error。

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { RequestContext } from '../../src/app/context.ts';
import { abandonedByClient } from '../../src/app/server.ts';
import { streamReply } from '../../src/app/sse-reply.ts';
import { captureLogs } from '../safety-helpers.ts';

class FakeResponse extends EventEmitter {
  writableEnded = false;
  readonly written: string[] = [];
  head: number | null = null;
  writeHead(status: number): void {
    this.head = status;
  }
  write(chunk: string): void {
    this.written.push(chunk);
  }
  end(): void {
    this.writableEnded = true;
  }
}

function contextWith(res: FakeResponse): RequestContext {
  return { res } as unknown as RequestContext;
}

const failures = (logs: string[]): string[] => logs.filter((line) => line.includes('request_failed'));

/** 等到被叫停才结束的一次生成：和模型调用一样，叫停时抛「已中止」。 */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

test('还没出第一段字页面就断开：不抛错、不记失败', async (t) => {
  const logs = captureLogs(t);
  const res = new FakeResponse();
  const reply = streamReply(contextWith(res), (signal) => untilAborted(signal));
  res.emit('close');
  assert.equal(await reply, 'streamed');
  assert.equal(res.head, null);
  assert.equal(res.writableEnded, true);
  assert.deepEqual(failures(logs), []);
  assert.equal(res.listenerCount('close'), 0);
});

test('送到一半页面断开：不再往里写、不记失败', async (t) => {
  const logs = captureLogs(t);
  const res = new FakeResponse();
  const reply = streamReply(contextWith(res), async (signal, onText) => {
    onText('半句');
    return untilAborted(signal);
  });
  await new Promise((resolve) => setImmediate(resolve));
  res.emit('close');
  assert.equal(await reply, 'streamed');
  assert.equal(res.written.length, 1);
  assert.match(res.written[0] ?? '', /"type":"text","delta":"半句"/);
  assert.deepEqual(failures(logs), []);
});

test('真出错：头还没发照旧抛给外层；发过头的在流里回最后一条 error 并记一笔', async (t) => {
  const logs = captureLogs(t);
  const early = new FakeResponse();
  await assert.rejects(streamReply(contextWith(early), () => Promise.reject(new Error('模型那边出错了'))),
    /模型那边出错了/);
  const late = new FakeResponse();
  const reply = await streamReply(contextWith(late), (_signal, onText) => {
    onText('半句');
    return Promise.reject(new Error('模型那边出错了'));
  });
  assert.equal(reply, 'streamed');
  assert.match(late.written.at(-1) ?? '', /"type":"error"/);
  assert.equal(failures(logs).length, 1);
});

test('正常生成完：送出每一段和最后的 done', async () => {
  const res = new FakeResponse();
  const reply = await streamReply(contextWith(res), (_signal, onText) => {
    onText('一');
    onText('二');
    return Promise.resolve({ text: '一二' });
  });
  assert.equal(reply, 'streamed');
  assert.equal(res.head, 200);
  assert.equal(res.written.length, 3);
  assert.match(res.written[2] ?? '', /"type":"done","view":\{"text":"一二"\}/);
});

test('普通接口也一样：连接已经关了又是被叫停的才不算出错，别的错照旧算', () => {
  const aborted = AbortSignal.abort().reason as unknown;
  assert.equal(abandonedByClient({ closed: true, writableEnded: false }, aborted), true);
  assert.equal(abandonedByClient({ closed: false, writableEnded: false }, aborted), false);
  assert.equal(abandonedByClient({ closed: true, writableEnded: false }, new Error('库坏了')), false);
  assert.equal(abandonedByClient({ closed: true, writableEnded: true }, aborted), false);
});
