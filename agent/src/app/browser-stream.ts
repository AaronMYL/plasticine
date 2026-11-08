// 浏览器帧仅送到当前观看会话。没有广播、回放或持久化；每帧都检查登录，ACK 也验证会话归属。
import {
  BrowserAckSchema, BrowserStreamQuerySchema, type BrowserStreamEvent,
} from '../../shared/api/index.ts';
import type { BrowserWatch, CloudBrowser } from '../cloud-tools/index.ts';
import { stillAuthenticated } from './auth.ts';
import { requireAuth, type HandlerResult, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

// 页面标题、跳转和网站自己开的标签页不一定伴随输入；每两秒刷新元数据。
const STATUS_INTERVAL_MS = 2_000;
const CONNECT_MS = 10_000;
const MAX_STREAM_BYTES = 5_000_000;
interface Watching {
  sessionId: string; streamId: string; ack(sequence: number): Promise<void>; end(): void;
}
const streams = new WeakMap<CloudBrowser, Watching>();

export async function streamBrowser(context: RequestContext): Promise<HandlerResult> {
  const auth = requireAuth(context);
  const { res, deps } = context;
  const query = checkInput(BrowserStreamQuerySchema, {
    streamId: context.url.searchParams.get('streamId'),
    width: Number(context.url.searchParams.get('width')), height: Number(context.url.searchParams.get('height')),
    deviceScaleFactor: Number(context.url.searchParams.get('deviceScaleFactor') ?? 1),
  }, '浏览器画面');
  const { browser } = deps.m5b.cloud;
  streams.get(browser)?.end();
  const lifetime = new AbortController();
  let cast: BrowserWatch | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;
  let earlyAck: number | undefined;
  let off: (() => void) | undefined;
  let unhook: (() => void) | undefined;
  const write = (event: BrowserStreamEvent): void => {
    if (lifetime.signal.aborted) {
      return;
    }
    if (!stillAuthenticated(deps, auth) || res.writableLength > MAX_STREAM_BYTES) {
      end();
      return;
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const end = (): void => {
    if (lifetime.signal.aborted) {
      return;
    }
    lifetime.abort();
    clearInterval(timer);
    off?.();
    unhook?.();
    if (streams.get(browser) === watching) {
      streams.delete(browser);
    }
    // 断线时 stopScreencast 也可能失败；连接关闭后浏览器状态在下次读取时恢复。
    void cast?.close().catch(() => browser.disconnect());
    res.end();
  };
  const watching: Watching = {
    sessionId: auth.session.id, streamId: query.streamId,
    ack: async (sequence) => {
      if (cast === undefined) {
        earlyAck = sequence;
      } else {
        await cast.ack(sequence);
      }
    },
    end: () => {
      write({ type: 'unavailable', message: '画面已在另一个页面打开，请点重试接回。' });
      end();
    },
  };
  streams.set(browser, watching);
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
    connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.flushHeaders();
  res.on('close', end);
  const subscription = deps.hub.subscribe({ sessionId: auth.session.id, deviceId: auth.device.id }, null,
    () => undefined, end);
  unhook = () => subscription.unsubscribe();
  off = browser.subscribe((view) => write({ type: 'status', browser: view }));
  const unavailable = (): void => {
    write({ type: 'unavailable', message: '浏览器还没起来，请重试。' });
    end();
  };
  try {
    cast = await browser.watch(query, (frame) => write({ type: 'frame', frame }), unavailable,
      AbortSignal.any([lifetime.signal, AbortSignal.timeout(CONNECT_MS)]));
    if (lifetime.signal.aborted) {
      await cast.close();
      return 'streamed';
    }
    if (earlyAck !== undefined) {
      await cast.ack(earlyAck);
    }
    write({ type: 'status', browser: browser.view() });
    timer = setInterval(() => {
      if (!stillAuthenticated(deps, auth)) {
        end();
      } else if (!refreshing) {
        refreshing = true;
        void browser.refresh(AbortSignal.any([lifetime.signal, AbortSignal.timeout(CONNECT_MS)]))
          .catch(unavailable).finally(() => { refreshing = false; });
      }
    }, STATUS_INTERVAL_MS);
  } catch {
    unavailable();
  }
  return 'streamed';
}

export async function ackBrowser(context: RequestContext): Promise<Reply> {
  const auth = requireAuth(context);
  const body = checkInput(BrowserAckSchema, await readJsonBody(context.req), '画面确认');
  const watching = streams.get(context.deps.m5b.cloud.browser);
  const owns = stillAuthenticated(context.deps, auth) && watching?.sessionId === auth.session.id
    && watching.streamId === body.streamId;
  if (owns) {
    await watching.ack(body.sequence);
  }
  return { status: 200, body: { ok: owns } };
}
