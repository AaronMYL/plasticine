// POST /v2/direct/offer（11-12《首次使用解耦》，约定 shared/api/direct.ts）：页面交来 WebRTC offer，答一个 answer。
// 要登录；通道绑在这次登录会话上（转请求时带这次的会话 cookie）。只从对外网址来的页面才有意义，本机打开的不握手。

import { DirectOfferRequestSchema, type DirectOfferResponse } from '../../shared/api/direct.ts';
import { errorCategory, safeLog } from '../shared-log.ts';
import { ApiError } from './api-error.ts';
import { SESSION_COOKIE } from './config.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { parseCookies, readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

export async function directOffer(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(DirectOfferRequestSchema, await readJsonBody(context.req), '直连握手');
  const token = parseCookies(context.req.headers.cookie).get(SESSION_COOKIE);
  const host = context.req.headers.host;
  if (token === undefined || token === '' || host === undefined || host === '') {
    throw new ApiError(400, 'invalid_request', '这次请求没带会话，直连握不了手。');
  }
  try {
    const sdp = await context.deps.direct.answer(body.sdp, { sessionId: auth.session.id,
      cookie: `${SESSION_COOKIE}=${token}`, host });
    const reply: DirectOfferResponse = { sdp };
    return { status: 200, body: reply };
  } catch (error) {
    safeLog('warn', 'direct_offer_failed', { category: errorCategory(error) });
    throw new ApiError(422, 'direct_unavailable', '这次直连没握上手，先经中继。');
  }
}
