// 「在别的设备上用」的自己的网址（11-12《首次使用解耦》，约定 shared/api/account.ts）：他用 Tailscale、隧道或自己的反向
// 代理把一个 https 网址转到这台电脑的端口，存在这里；Plasticine 写给他的链接改用这个网址（public-url.ts）。
// 只收 https：明文的局域网地址不收（密码和会话会裸奔）。要登录才能读写，不进不用登录的账号状态。

import { OWN_URL_MAX_CHARS, OwnUrlRequestSchema, type OwnUrlView } from '../../shared/api/account.ts';
import type { StateService } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

export const OWN_URL_KEY = 'access.own_url';

const OWN_URL_RULE = '要填 https 开头的网址，不带路径、查询和登录信息，比如 https://plasticine.example.com。';

/** 收进来的网址规整成 https://host[:port]；不合规矩的抛出带原因的错。 */
export function normalizeOwnUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(OWN_URL_RULE);
  }
  if (text.length > OWN_URL_MAX_CHARS || url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(OWN_URL_RULE);
  }
  return url.origin;
}

/** 存着的自己的网址；没设或存坏了是 null。 */
export function storedOwnUrl(state: Pick<StateService, 'kernelSettings'>): string | null {
  const value = state.kernelSettings.get(OWN_URL_KEY);
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return normalizeOwnUrl(value);
  } catch {
    return null;
  }
}

/** GET /v2/account/own-url */
export function getOwnUrl(context: RequestContext): Reply {
  requireUserAuth(context);
  const body: OwnUrlView = { ownUrl: storedOwnUrl(context.deps.state) };
  return { status: 200, body };
}

/** PUT /v2/account/own-url：存或清掉（null）。 */
export async function putOwnUrl(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const input = checkInput(OwnUrlRequestSchema, await readJsonBody(context.req), '存网址');
  let ownUrl: string | null = null;
  if (input.ownUrl !== null && input.ownUrl.trim() !== '') {
    try {
      ownUrl = normalizeOwnUrl(input.ownUrl);
    } catch (error) {
      throw new ApiError(400, 'invalid_request', error instanceof Error ? error.message : OWN_URL_RULE,
        { field: 'ownUrl' });
    }
  }
  context.deps.state.kernelSettings.set(OWN_URL_KEY, ownUrl);
  const body: OwnUrlView = { ownUrl };
  return { status: 200, body };
}
