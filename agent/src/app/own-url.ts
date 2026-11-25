import { OWN_URL_MAX_CHARS, OwnUrlRequestSchema, type OwnUrlView } from '../../shared/api/account.ts';
import type { StateService } from '../state/index.ts';
import { ApiError } from './api-error.ts';
import { requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { checkInput } from './validate.ts';

export const OWN_URL_KEY = 'access.own_url';

const OWN_URL_RULE = '要填 https 开头的网址，不带路径、查询和登录信息，比如 https://plasticine.example.com。';

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
