import {
  AccountPasswordRequestSchema,
  AccountPatchRequestSchema,
  HandleSchema,
  type AccountPasswordResponse,
  type HandleAvailability,
} from '../../shared/api/account.ts';
import { Value } from 'typebox/value';
import { ApiError } from './api-error.ts';
import { param, requireUserAuth, type AuthContext, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { fromLoopback, localTokenValid } from './local-access.ts';
import { accountState } from './owner.ts';
import { checkNotLimited, passwordMatches, recordFailure } from './password-check.ts';
import { hashPassword } from './password-hash.ts';
import { checkInput } from './validate.ts';

/** GET /v2/account/state */
export function getAccountState(context: RequestContext): Reply {
  return { status: 200, body: accountState(context.deps) };
}

/** GET /v2/account/handles/:handle */
export async function handleAvailability(context: RequestContext): Promise<Reply> {
  const handle = param(context, 'handle');
  if (!Value.Check(HandleSchema, handle)) {
    const body: HandleAvailability = { handle, available: false, reason: 'invalid' };
    return { status: 200, body };
  }
  return { status: 200, body: await context.deps.network.handleAvailability(handle) };
}

export async function patchAccount(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(AccountPatchRequestSchema, await readJsonBody(context.req), '改名字');
  const name = body.displayName.trim();
  if (name === '') {
    throw new ApiError(400, 'invalid_request', '名字不能是空的。', { field: 'displayName' });
  }
  const { state, network } = context.deps;
  state.ownerAccount.setName(name);
  if (state.networkIdentity.get() !== undefined) {
    network.rename(name);
  }
  return { status: 200, body: accountState(context.deps) };
}

function currentNotNeeded(context: RequestContext, auth: AuthContext): boolean {
  const { deps, req } = context;
  if (deps.state.ownerAccount.credentials() === null || localTokenValid(deps.localToken, req)) {
    return true;
  }
  return auth.device.local === true && deps.localToken !== null && deps.localToken !== '' && fromLoopback(req);
}

/** PUT /v2/account/password */
export async function setAccountPassword(context: RequestContext): Promise<Reply> {
  const auth = requireUserAuth(context);
  const body = checkInput(AccountPasswordRequestSchema, await readJsonBody(context.req), '改密码');
  const source = checkNotLimited(context);
  if (!currentNotNeeded(context, auth)) {
    if (body.current === undefined || body.current === '') {
      throw new ApiError(400, 'invalid_request', '要先填现在的密码。', { field: 'current' });
    }
    if (!await passwordMatches(context.deps, body.current)) {
      recordFailure(context, source);
      throw new ApiError(401, 'password_wrong', '现在的密码不对。', { field: 'current',
        next: '核对后再输；忘了的话，在装着 Plasticine 的那台电脑上重设。' });
    }
  }
  const { hash, salt } = await hashPassword(body.password);
  const at = context.deps.now().toISOString();
  context.deps.state.ownerAccount.setPassword(hash, salt, at);
  const reply: AccountPasswordResponse = { passwordSetAt: at };
  return { status: 200, body: reply };
}
