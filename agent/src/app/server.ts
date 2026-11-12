// One request: match the route → who is asking → 401 without a session → the resource's handler → JSON (or
// bytes, or the stream the handler wrote). Every failure leaves here in the API's error format.

import { errorCategory, safeLog } from '../shared-log.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, toApiError, unauthorized } from './api-error.ts';
import { authenticate } from './auth.ts';
import { pickEncoding, sensitivePath } from './compression.ts';
import type { AppDeps, HandlerResult } from './context.ts';
import { sendBytes, sendJson } from './http.ts';
import { responseTextPolicy } from './outbound-policy.ts';
import { matchRoute } from './router.ts';

async function respond(deps: AppDeps, req: IncomingMessage, res: ServerResponse): Promise<HandlerResult> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = matchRoute(req.method ?? 'GET', url.pathname);
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
  return match.route.handler({ req, res, url, params: match.params, auth, deps });
}

function writeError(deps: AppDeps, pathname: string, res: ServerResponse, error: unknown): void {
  const mapped = toApiError(error);
  if (mapped.unexpected) {
    // 路径本身也可能带凭据或用户内容，只记录受控错误类别。
    safeLog('error', 'request_failed', { category: errorCategory(error) });
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = mapped.error.body();
  sendJson(res, mapped.error.status, body, {}, responseTextPolicy(pathname, body, deps.state));
}

async function handle(deps: AppDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let pathname = '';
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const result = await respond(deps, req, res);
    if (result === 'streamed') {
      return;
    }
    if (result.bytes !== undefined) {
      const { data, type, download } = result.bytes;
      sendBytes(res, result.status, data, type, { ...(download === undefined ? {} : { download }),
        ...(result.bytes.noStore === undefined ? {} : { noStore: result.bytes.noStore }) });
    } else {
      const body = result.body ?? null;
      const policy = responseTextPolicy(pathname, body, deps.state);
      const encoding = sensitivePath(pathname) ? null : pickEncoding(req.headers['accept-encoding']);
      sendJson(res, result.status, body, result.headers ?? {}, policy, encoding);
    }
  } catch (error) {
    writeError(deps, pathname, res, error);
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
