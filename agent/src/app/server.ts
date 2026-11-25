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

interface Asker {
  own: boolean;
  route: string | null;
  longPoll: boolean;
}

async function respond(deps: AppDeps, req: IncomingMessage, res: ServerResponse, asker: Asker):
  Promise<HandlerResult> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = matchRoute(req.method ?? 'GET', url.pathname);
  if (match.kind === 'found') {
    asker.route = match.route.path;
    asker.longPoll = match.route.longPoll === true;
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

export function abandonedByClient(res: Pick<ServerResponse, 'closed' | 'writableEnded'>, error: unknown): boolean {
  return res.closed && !res.writableEnded && error instanceof Error && error.name === 'AbortError';
}

function writeError(deps: AppDeps, pathname: string, res: ServerResponse, error: unknown, asker: Asker,
  method: string): void {
  if (abandonedByClient(res, error)) {
    return;
  }
  const mapped = toApiError(error);
  if (mapped.unexpected) {
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

function timeRequest(deps: AppDeps, res: ServerResponse, asker: Asker, method: string, started: number): void {
  res.once('finish', () => {
    if (asker.longPoll) {
      return;
    }
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
  const asker: Asker = { own: false, route: null, longPoll: false };
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
      safeLog('error', 'error_response_failed', { category: errorCategory(error) });
      res.destroy();
    });
  };
}
