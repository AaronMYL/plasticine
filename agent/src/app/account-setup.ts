import {
  AccountSetupRequestSchema,
  type AccountSetupRequest,
  type AccountSetupResponse,
} from '../../shared/api/account.ts';
import { errorCategory, safeLog } from '../util/index.ts';
import { ApiError } from './api-error.ts';
import type { AppDeps, Reply, RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { localTokenValid } from './local-access.ts';
import { loginDevice, loginReply, setupNeeded } from './owner.ts';
import { checkNotLimited, recordFailure } from './password-check.ts';
import { hashPassword } from './password-hash.ts';
import { setupTokenHash } from './setup-link.ts';
import { checkInput } from './validate.ts';
import { postWelcome } from './welcome.ts';

const NETWORK_LATER = '以后在「设置 · 账号」里再起。';

function alreadySetUp(): ApiError {
  return new ApiError(409, 'already_set_up', '这份 Plasticine 已经有主人了。', { next: '用 @账号和密码登录。' });
}

function invalidToken(): ApiError {
  return new ApiError(401, 'setup_token_invalid', '建账号链接不对、过期了或者用过了。', {
    next: '在服务器上运行 plasticine setup-link 拿一条新的（30 分钟内有效，只能用一次）。',
  });
}

async function joinNetwork(deps: AppDeps, body: AccountSetupRequest, name: string):
  Promise<AccountSetupResponse['network']> {
  if (body.handle === null) {
    return { joined: false, url: null, problem: null };
  }
  try {
    const identity = await deps.network.join({ handle: body.handle, displayName: name, inviteCode: null,
      relayUrl: null });
    if (identity.displayName !== name) {
      deps.network.rename(name);
    }
    return { joined: true, url: `https://${deps.network.publicHost(identity.handle)}`, problem: null };
  } catch (error) {
    safeLog('warn', 'account_network_join_failed', { category: errorCategory(error) });
    const reason = error instanceof Error && error.message !== '' ? error.message : '没连上 Cyber Hunter 网络。';
    return { joined: false, url: null, problem: `@${body.handle} 这次没起成：${reason}${NETWORK_LATER}` };
  }
}

/** POST /v2/account/setup */
export async function setupAccount(context: RequestContext): Promise<Reply> {
  const { deps } = context;
  const body = checkInput(AccountSetupRequestSchema, await readJsonBody(context.req), '建账号');
  const source = checkNotLimited(context);
  const viaLocal = localTokenValid(deps.localToken, context.req);
  if (!viaLocal && body.setupToken === undefined) {
    throw new ApiError(403, 'setup_not_allowed', '建账号要在装着 Plasticine 的那台电脑上，或者用建账号链接打开。', {
      next: '桌面客户端会自动带上；服务器上运行 plasticine setup-link 拿链接。',
    });
  }
  if (!setupNeeded(deps.state)) {
    throw alreadySetUp();
  }
  const name = body.displayName.trim();
  if (name === '') {
    throw new ApiError(400, 'invalid_request', '名字不能是空的。', { field: 'displayName' });
  }
  const { hash, salt } = await hashPassword(body.password);
  const now = deps.now();
  const login = deps.state.transaction(() => {
    if (!setupNeeded(deps.state)) {
      throw alreadySetUp();
    }
    if (!viaLocal && !deps.state.ownerAccount.takeSetupToken(setupTokenHash(body.setupToken ?? ''),
      now.toISOString())) {
      return null;
    }
    deps.state.ownerAccount.setName(name);
    deps.state.ownerAccount.setPassword(hash, salt, now.toISOString());
    return loginDevice(deps, { name: body.deviceName, local: viaLocal }, now);
  });
  if (login === null) {
    recordFailure(context, source);
    throw invalidToken();
  }
  const network = await joinNetwork(deps, body, name);
  postWelcome(deps.lines, name);
  const reply: AccountSetupResponse = { session: login.view, network };
  return loginReply(login, reply);
}
