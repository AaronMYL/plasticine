// One request: match the route → who is asking → 401 without a session → the resource's handler → JSON (or
// bytes, or the stream the handler wrote). Every failure leaves here in the API's error format.

import { errorCategory, safeLog } from '../util/index.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, toApiError, unauthorized } from './api-error.ts';
import { authenticate } from './auth.ts';
import { pickEncoding, sensitivePath } from './compression.ts';
import type { AppDeps, HandlerResult } from './context.ts';
import { sendBytes, sendJson } from './http.ts';
import { responseTextPolicy } from './outbound-policy.ts';
import { SLOW_REQUEST_MS } from './diagnostics.ts';
import { matchRoute } from './router.ts';

/** 谁在问：他自己的设备（会话或节点）回原链接，不清洗（11-14 Aaron 定「自己用不清洗，分享出去才清洗」）。 */
interface Asker {
  own: boolean;
  /** 认出来的路由模板（`/v2/lines/:lineId`）；没认出来是 null。日志和体检只记它，不记真路径。 */
  route: string | null;
}

async function respond(deps: AppDeps, req: IncomingMessage, res: ServerResponse, asker: Asker):
  Promise<HandlerResult> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = matchRoute(req.method ?? 'GET', url.pathname);
  if (match.kind === 'found') {
    asker.route = match.route.path;
  }
  if (match.kind === 'none') {
    throw new ApiError(404, 'not_found', '没有这个接口。', { next: '核对路径；接口都以 /v2/ 开头。' });
  }
  if (match.kind === 'wrong_method') {
    throw new ApiError(405, 'method_not_allowed', '这个接口不接受这种请求方法。', {
      next: `可用的方法：${match.allowed.join('、')}。`,
    });
  }
  const auth = authenticate(deps, req);
  if (match.route.auth && auth === null) {
    throw unauthorized();
  }
  if (auth !== null) {
    deps.devicePaths.see(auth.device.id, req);
  }
  asker.own = auth !== null || match.route.node === true;
  return match.route.handler({ req, res, url, params: match.params, auth, deps });
}

function writeError(deps: AppDeps, pathname: string, res: ServerResponse, error: unknown, asker: Asker,
  method: string): void {
  const mapped = toApiError(error);
  if (mapped.unexpected) {
    // 路径本身也可能带凭据或用户内容，只记路由模板；11-16 起带上错误原文和位置（日志工具会洗掉像凭据的东西）。
    const route = asker.route ?? '(未知路由)';
    safeLog('error', 'request_failed', { category: errorCategory(error), route, method, error });
    deps.diagnostics.error(route, method, mapped.error.status, error);
  }
  const own = asker.own;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = mapped.error.body();
  sendJson(res, mapped.error.status, body, {}, own ? undefined : responseTextPolicy(pathname, body, deps.state), null,
    !own);
}

/** 记一个请求的耗时（等回答写完）；慢的写日志。流式的（事件流）不算。 */
function timeRequest(deps: AppDeps, res: ServerResponse, asker: Asker, method: string, started: number): void {
  res.once('finish', () => {
    const ms = performance.now() - started;
    const route = asker.route ?? '(未知路由)';
    deps.diagnostics.request(route, method, res.statusCode, ms);
    if (ms >= SLOW_REQUEST_MS) {
      safeLog('warn', 'request_slow', { route, method, status: res.statusCode, durationMs: ms });
    }
  });
}

async function handle(deps: AppDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let pathname = '';
  const asker: Asker = { own: false, route: null };
  const method = req.method ?? 'GET';
  const started = performance.now();
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const result = await respond(deps, req, res, asker);
    if (result === 'streamed') {
      return;
    }
    timeRequest(deps, res, asker, method, started);
    if (result.bytes !== undefined) {
      const { data, type, download } = result.bytes;
      sendBytes(res, result.status, data, type, { ...(download === undefined ? {} : { download }),
        ...(result.bytes.noStore === undefined ? {} : { noStore: result.bytes.noStore }) });
    } else {
      const body = result.body ?? null;
      const policy = asker.own ? undefined : responseTextPolicy(pathname, body, deps.state);
      const encoding = sensitivePath(pathname) ? null : pickEncoding(req.headers['accept-encoding']);
      sendJson(res, result.status, body, result.headers ?? {}, policy, encoding, !asker.own);
    }
  } catch (error) {
    timeRequest(deps, res, asker, method, started);
    writeError(deps, pathname, res, error, asker, method);
  }
}

export function createRequestHandler(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(deps, req, res).catch((error: unknown) => {
      // Only reachable when even the error answer could not be written; the connection is dropped.
      safeLog('error', 'error_response_failed', { category: errorCategory(error) });
      res.destroy();
    });
  };
}
