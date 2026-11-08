import { Type } from 'typebox';
import { cdpValue, CdpBooleanSchema } from './cdp-protocol.ts';
import type { CdpConnection } from './cdp-connection.ts';
import { CloudToolError } from './errors.ts';
const ResponseEvent = Type.Object({ requestId: Type.String(), response: Type.Object({
  url: Type.String(), status: Type.Number() }) });
const LoadingEvent = Type.Object({ requestId: Type.String() });
const BodyResponse = Type.Object({ body: Type.String(), base64Encoded: Type.Boolean() });
const TweetResponse = Type.Object({ data: Type.Optional(Type.Object({ create_tweet: Type.Optional(Type.Object({
  tweet_results: Type.Optional(Type.Object({ result: Type.Optional(Type.Object({ rest_id: Type.String() })) })) })) })),
  errors: Type.Optional(Type.Array(Type.Object({ message: Type.String() }))) });
const READY = `new Promise(resolve => { const end = Date.now() + 15000; const check = () => {
  const editor = document.querySelector('[data-testid="tweetTextarea_0"][contenteditable="true"]');
  if (editor && editor.getBoundingClientRect().width > 0) { editor.focus(); resolve(true); }
  else if (Date.now() > end) resolve(false); else setTimeout(check, 100);
}; check(); })`;

/** 只在已批准原文后调用。用浏览器原会话发出，成功依据为 CreateTweet 回执里的真实帖子 id。 */
export async function publishXThroughPage(connection: Pick<CdpConnection, 'send' | 'onEvent'>,
  sessionId: string, text: string, signal: AbortSignal): Promise<{ url: string }> {
  let clicked = false; let requestId: string | null = null;
  let status = 0; let finish: (result: { url: string }) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const result = new Promise<{ url: string }>((resolve, reject) => { finish = resolve; fail = reject; });
  // 在准备输入阶段也可能断线；承接拒绝，实际返回时仍抛同一个错误。
  void result.catch(() => undefined);
  const abort = () => fail(new CloudToolError(clicked ? 'unknown' : 'failed',
    clicked ? '发布请求已发起，但没有读到最终回执；请核对 X，不能直接重复发布。' : '发布已停止，没有点发布。'));
  signal.addEventListener('abort', abort, { once: true });
  const stop = connection.onEvent((event) => {
    if (!clicked || event.sessionId !== sessionId) return;
    if (event.method === 'Network.responseReceived') {
      const data = cdpValue(ResponseEvent, event.params);
      if (new URL(data.response.url).pathname.endsWith('/CreateTweet')) {
        requestId = data.requestId; status = data.response.status;
      }
    } else if (event.method === 'Network.loadingFinished') {
      const eventData = cdpValue(LoadingEvent, event.params);
      if (eventData.requestId !== requestId) return;
      void connection.send('Network.getResponseBody', { requestId }, signal, sessionId).then((raw) => {
        const body = cdpValue(BodyResponse, raw);
        const response = cdpValue(TweetResponse, JSON.parse(body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8') : body.body));
        const id = response.data?.create_tweet?.tweet_results?.result?.rest_id;
        if (id !== undefined) finish({ url: `https://x.com/i/status/${id}` });
        else fail(new CloudToolError(status >= 400 || response.errors?.length ? 'failed' : 'unknown',
          response.errors?.map((error) => error.message).join('；') || `X 没有返回帖子 id（HTTP ${status}）。`));
      }, fail).catch(fail);
    }
  });
  try {
    await connection.send('Network.enable', {}, signal, sessionId);
    const ready = cdpValue(CdpBooleanSchema, await connection.send('Runtime.evaluate',
      { expression: READY, returnByValue: true, awaitPromise: true }, signal, sessionId));
    if (!ready.result.value) {
      throw new CloudToolError('failed', 'X 发布框未出现，请在服务器浏览器确认已登录。没有发布。');
    }
    // 新开的 compose 页应为空；避免把登录页或保留的草稿误当成待发原文。
    const empty = cdpValue(CdpBooleanSchema, await connection.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="tweetTextarea_0"]').innerText.trim() === ''`,
      returnByValue: true,
    }, signal, sessionId));
    if (!empty.result.value) throw new CloudToolError('failed', 'X 发布框已有草稿，请先核对这份草稿。没有发布。');
    await connection.send('Input.insertText', { text }, signal, sessionId);
    const matched = cdpValue(CdpBooleanSchema, await connection.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="tweetTextarea_0"]').innerText === ${JSON.stringify(text)}
        && (() => { const b = document.querySelector('[data-testid="tweetButton"]');
          return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; })()`, returnByValue: true,
    }, signal, sessionId));
    if (!matched.result.value) throw new CloudToolError('failed', 'X 上的原文或发布按钮状态与授权卡不一致。没有发布。');
    signal.throwIfAborted(); clicked = true;
    await connection.send('Runtime.evaluate', { expression:
      `document.querySelector('[data-testid="tweetButton"]').click()`, returnByValue: true }, signal, sessionId);
    return await result;
  } catch (cause) {
    if (cause instanceof CloudToolError && (cause.code === 'failed' || cause.code === 'unknown')) throw cause;
    throw new CloudToolError(clicked ? 'unknown' : 'failed', cause instanceof Error ? cause.message : String(cause));
  } finally { stop(); signal.removeEventListener('abort', abort); }
}
